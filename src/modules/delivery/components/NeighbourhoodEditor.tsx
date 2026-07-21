"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Calculator, Bike, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import {
    ownBoyRatePaise,
    ownBoyVehicleFits,
    ownBoyPincodeLocalities,
    ownBoyVehicles,
    ownBoyAllNeighbourhoods,
    type OwnBoyConfig,
    type OwnBoyMatrix,
    type OwnBoyVehicle,
    type OwnBoyLocality,
} from "@/modules/delivery/lib/deliveryMethodConfig";

// Settings → Standard Courier → Local courier tab. The local delivery boy runs a
// LIST of local couriers = vehicles (Bike / Car / …). Each vehicle is its own
// courier at checkout — its own coverage (PINCODE → LOCALITY → NEIGHBOURHOOD), its
// own weight slabs + per-row rates, and a weight limit (a parcel over the limit
// isn't offered that vehicle). Ladder: neighbourhood rate → locality rate → not
// served (no flat fallback). Stored on the OWN_BOY method.

type Method = { id: number; kind: string; configJson: Record<string, unknown> };
type NbForm = { name: string; baseRupees: string; addlRupees: string };
type LocalityForm = { name: string; baseRupees: string; addlRupees: string; neighbourhoods: NbForm[] };
type PinForm = { pincode: string; localities: LocalityForm[]; areaOptions: string[] };
type VehicleForm = {
    name: string;
    isActive: boolean;
    maxKg: string; // weight limit in kg; blank/0 = no limit
    baseGrams: string;
    stepGrams: string;
    freeAboveRupees: string;
    pins: PinForm[];
};

const rupees = (paise: unknown) => {
    const n = Number(paise) || 0;
    return n > 0 ? (n / 100).toString() : "";
};
const toPaise = (r: string) => Math.max(0, Math.round((parseFloat(r) || 0) * 100));
const toPaiseOpt = (r: string): number | undefined => {
    const v = toPaise(r);
    return v > 0 ? v : undefined;
};
/** Grams string → "= N kg" caption (blank when 0). */
const kgLabel = (grams: string): string => {
    const n = parseInt(grams, 10) || 0;
    return n > 0 ? `= ${Number((n / 1000).toFixed(3))} kg` : "";
};

function pinsFromMatrix(m: OwnBoyMatrix): PinForm[] {
    const nb = m.neighbourhoods ?? {};
    return Object.keys(nb).map((pincode) => {
        const byLoc = ownBoyPincodeLocalities(m, pincode);
        return {
            pincode,
            areaOptions: [],
            localities: Object.entries(byLoc).map(([name, l]) => ({
                name,
                baseRupees: rupees(l.basePaise),
                addlRupees: rupees(l.addlPaise),
                neighbourhoods: l.neighbourhoods.map((n) => ({
                    name: n.name,
                    baseRupees: rupees(n.basePaise),
                    addlRupees: rupees(n.addlPaise),
                })),
            })),
        };
    });
}

function vehicleFromCfg(v: OwnBoyVehicle): VehicleForm {
    return {
        name: v.name || "Vehicle",
        isActive: v.isActive !== false,
        maxKg: v.maxWeightGrams ? String(v.maxWeightGrams / 1000) : "",
        baseGrams: String(v.baseGrams ?? 500),
        stepGrams: String(v.stepGrams ?? 500),
        freeAboveRupees: rupees(v.freeAbovePaise),
        pins: pinsFromMatrix(v),
    };
}

function newVehicle(name = "Vehicle"): VehicleForm {
    return { name, isActive: true, maxKg: "", baseGrams: "500", stepGrams: "500", freeAboveRupees: "", pins: [] };
}

// Form pins → stored neighbourhoods map (merge cards sharing a pincode/locality).
function buildNeighbourhoods(pins: PinForm[]): Record<string, Record<string, OwnBoyLocality>> {
    const out: Record<string, Record<string, OwnBoyLocality>> = {};
    for (const p of pins) {
        if (!/^\d{6}$/u.test(p.pincode)) continue;
        const byLoc = out[p.pincode] ?? {};
        for (const l of p.localities) {
            const key = l.name.trim();
            if (!key) continue;
            const ns = l.neighbourhoods
                .map((n) => ({ name: n.name.trim(), basePaise: toPaiseOpt(n.baseRupees), addlPaise: toPaiseOpt(n.addlRupees) }))
                .filter((n) => n.name);
            if (ns.length === 0) continue;
            const prev = byLoc[key];
            byLoc[key] = {
                basePaise: toPaiseOpt(l.baseRupees) ?? prev?.basePaise,
                addlPaise: toPaiseOpt(l.addlRupees) ?? prev?.addlPaise,
                neighbourhoods: [...(prev?.neighbourhoods ?? []), ...ns],
            };
        }
        if (Object.keys(byLoc).length > 0) out[p.pincode] = byLoc;
    }
    return out;
}

function vehicleToCfg(v: VehicleForm): OwnBoyVehicle {
    return {
        name: v.name.trim() || "Vehicle",
        isActive: v.isActive,
        maxWeightGrams: Math.round((parseFloat(v.maxKg) || 0) * 1000) || undefined,
        baseGrams: parseInt(v.baseGrams, 10) || 500,
        stepGrams: parseInt(v.stepGrams, 10) || 500,
        freeAbovePaise: toPaise(v.freeAboveRupees),
        neighbourhoods: buildNeighbourhoods(v.pins),
    };
}

export default function NeighbourhoodEditor() {
    const [method, setMethod] = useState<Method | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);

    const [vehicles, setVehicles] = useState<VehicleForm[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);

    // Live preview inputs.
    const [testGrams, setTestGrams] = useState("1000");
    const [testSubtotal, setTestSubtotal] = useState("2000");
    const [testPincode, setTestPincode] = useState("");
    const [testNeighbourhood, setTestNeighbourhood] = useState("");

    const load = useCallback(async () => {
        try {
            const { data } = await axios.get<{ methods: Method[] }>("/api/settings/couriers");
            const row = data.methods.find((m) => m.kind === "OWN_BOY") ?? null;
            setMethod(row);
            const cfg = ((row?.configJson ?? {}) as OwnBoyConfig) ?? {};
            const list = ownBoyVehicles(cfg).map(vehicleFromCfg);
            setVehicles(list.length > 0 ? list : [newVehicle("Local delivery")]);
            setActiveIdx(0);
            setLoaded(true);
        } catch {
            setLoaded(true);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const active: VehicleForm | undefined = vehicles[activeIdx];
    const patchActive = (patch: Partial<VehicleForm>) =>
        setVehicles((vs) => vs.map((v, i) => (i === activeIdx ? { ...v, ...patch } : v)));
    const setActivePins = (updater: (pins: PinForm[]) => PinForm[]) =>
        patchActive({ pins: updater(active?.pins ?? []) });

    const setPin = (i: number, patch: Partial<PinForm>) =>
        setActivePins((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    const setLoc = (i: number, li: number, patch: Partial<LocalityForm>) =>
        setActivePins((ps) =>
            ps.map((p, j) => (j === i ? { ...p, localities: p.localities.map((l, k) => (k === li ? { ...l, ...patch } : l)) } : p))
        );
    const setNb = (i: number, li: number, ni: number, patch: Partial<NbForm>) =>
        setActivePins((ps) =>
            ps.map((p, j) =>
                j === i
                    ? {
                          ...p,
                          localities: p.localities.map((l, k) =>
                              k === li ? { ...l, neighbourhoods: l.neighbourhoods.map((n, m) => (m === ni ? { ...n, ...patch } : n)) } : l
                          ),
                      }
                    : p
            )
        );

    // Pull the India Post area list for a pincode so localities are picked, not typed.
    const fetchAreas = async (i: number, pincode: string) => {
        if (!/^\d{6}$/u.test(pincode)) return;
        try {
            const { data } = await axios.get<{ ok: boolean; localities?: string[] }>(`/api/shop/pincode/${pincode}`);
            setPin(i, { areaOptions: data.ok && Array.isArray(data.localities) ? data.localities : [] });
        } catch {
            setPin(i, { areaOptions: [] });
        }
    };

    const buildConfig = useCallback((): OwnBoyConfig => {
        return {
            ...((method?.configJson ?? {}) as OwnBoyConfig),
            pincodes: [],
            flatPaise: 0,
            neighbourhoods: {}, // top-level cleared; vehicles are the source of truth
            vehicles: vehicles.map(vehicleToCfg),
        };
    }, [method, vehicles]);

    const save = async () => {
        if (!method) return;
        setSaving(true);
        try {
            await axios.patch(`/api/settings/couriers/${method.id}`, { configJson: buildConfig() });
            toast.success("Local couriers saved");
            await load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to save") : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    // Preview mirrors checkout: pick a configured pincode + neighbourhood, then see
    // every vehicle's result (price / over-weight / not-covered).
    const previewCfg = useMemo(() => buildConfig(), [buildConfig]);
    const previewPincodes = useMemo(
        () => [...new Set((previewCfg.vehicles ?? []).flatMap((v) => Object.keys(v.neighbourhoods ?? {})))].sort(),
        [previewCfg]
    );
    const previewNbOptions = useMemo(
        () =>
            /^\d{6}$/u.test(testPincode.trim())
                ? [...new Set(Object.values(ownBoyAllNeighbourhoods(previewCfg, testPincode.trim())).flat())]
                : [],
        [previewCfg, testPincode]
    );
    const previewRows = useMemo(() => {
        if (!/^\d{6}$/u.test(testPincode.trim())) return null;
        const g = parseInt(testGrams, 10) || 0;
        const rateParams = {
            weightGrams: g,
            subtotalPaise: toPaise(testSubtotal),
            pincode: testPincode.trim(),
            neighbourhood: testNeighbourhood.trim() || undefined,
        };
        return (previewCfg.vehicles ?? []).map((v) => ({
            name: v.name,
            active: v.isActive !== false,
            overWeight: !ownBoyVehicleFits(v, g),
            price: ownBoyRatePaise(v, rateParams),
        }));
    }, [previewCfg, testGrams, testSubtotal, testPincode, testNeighbourhood]);

    if (!loaded) return <p className="text-muted-foreground text-sm">Loading…</p>;
    if (!method) {
        return (
            <p className="text-muted-foreground text-sm">
                No local delivery boy courier exists. Create one under Settings → Couriers first.
            </p>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground text-sm max-w-2xl">
                Your local couriers — one per vehicle (e.g. <b>Bike</b>, <b>Car</b>). Each is its own courier at
                checkout with its own coverage, weight rates and <b>weight limit</b> (a parcel heavier than the limit
                isn&apos;t offered that vehicle). A neighbourhood is only delivered when the vehicle (or its locality)
                has a rate set — there is no flat fallback.
            </p>

            {/* Vehicle switcher. */}
            <div className="flex flex-wrap items-center gap-2">
                {vehicles.map((v, i) => (
                    <Button
                        key={i}
                        type="button"
                        size="sm"
                        variant={i === activeIdx ? "default" : "outline"}
                        onClick={() => setActiveIdx(i)}
                    >
                        <Bike className="size-4" />
                        {v.name || "Vehicle"}
                        {!v.isActive && <span className="text-[10px] opacity-70">(off)</span>}
                    </Button>
                ))}
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                        setVehicles((vs) => [...vs, newVehicle(`Vehicle ${vs.length + 1}`)]);
                        setActiveIdx(vehicles.length);
                    }}
                >
                    <Plus className="size-4" /> Add vehicle
                </Button>
            </div>

            {active ? (
                <>
                    {/* Vehicle header: name, active, weight limit, copy, remove. */}
                    <Card>
                        <CardContent className="flex flex-wrap items-end gap-3 py-4">
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Vehicle name</Label>
                                <Input className="w-40 font-medium" value={active.name} placeholder="e.g. Bike" onChange={(e) => patchActive({ name: e.target.value })} />
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Weight limit (kg, blank = none)</Label>
                                <Input className="w-36" value={active.maxKg} inputMode="decimal" placeholder="e.g. 20" onChange={(e) => patchActive({ maxKg: e.target.value })} />
                            </div>
                            <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
                                <Switch checked={active.isActive} onCheckedChange={(v) => patchActive({ isActive: v })} /> Active
                            </label>
                            <div className="ml-auto flex items-center gap-2">
                                {vehicles.length > 1 ? (
                                    <Select
                                        value="__copy__"
                                        onValueChange={(v) => {
                                            const from = parseInt(v, 10);
                                            if (!Number.isFinite(from)) return;
                                            // Deep-copy the source vehicle's coverage into the active one.
                                            const src = vehicles[from];
                                            patchActive({ pins: JSON.parse(JSON.stringify(src.pins)) as PinForm[] });
                                            toast.success(`Copied coverage from ${src.name || "vehicle"}`);
                                        }}
                                    >
                                        <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Copy coverage from…" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__copy__">
                                                <span className="flex items-center gap-1.5"><Copy className="size-3.5" /> Copy coverage from…</span>
                                            </SelectItem>
                                            {vehicles.map((v, i) => (i === activeIdx ? null : (
                                                <SelectItem key={i} value={String(i)}>{v.name || `Vehicle ${i + 1}`}</SelectItem>
                                            )))}
                                        </SelectContent>
                                    </Select>
                                ) : null}
                                {vehicles.length > 1 ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            setVehicles((vs) => vs.filter((_, j) => j !== activeIdx));
                                            setActiveIdx((idx) => Math.max(0, idx - (activeIdx === idx ? 1 : 0)));
                                        }}
                                        aria-label="Remove vehicle"
                                    >
                                        <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                ) : null}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Weight slabs (per vehicle). */}
                    <Card>
                        <CardContent className="flex flex-wrap items-end gap-3 py-4">
                            <div className="grid gap-1.5">
                                <Label className="text-xs">First slab (g)</Label>
                                <Input className="w-24" value={active.baseGrams} inputMode="numeric" onChange={(e) => patchActive({ baseGrams: e.target.value })} />
                                <span className="text-[10px] text-muted-foreground tabular-nums">{kgLabel(active.baseGrams)}</span>
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Each additional (g)</Label>
                                <Input className="w-28" value={active.stepGrams} inputMode="numeric" onChange={(e) => patchActive({ stepGrams: e.target.value })} />
                                <span className="text-[10px] text-muted-foreground tabular-nums">{kgLabel(active.stepGrams)}</span>
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs">Free above ₹ (0 = never)</Label>
                                <Input className="w-28" value={active.freeAboveRupees} inputMode="decimal" placeholder="0" onChange={(e) => patchActive({ freeAboveRupees: e.target.value })} />
                                <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground basis-full">
                                Rates below are per <b>{parseInt(active.baseGrams, 10) || 500} g</b> ({kgLabel(active.baseGrams) || "= 0.5 kg"}) first slab,
                                then each extra <b>{parseInt(active.stepGrams, 10) || 500} g</b> ({kgLabel(active.stepGrams) || "= 0.5 kg"}).
                            </p>
                        </CardContent>
                    </Card>

                    {active.pins.map((p, i) => {
                        const usedAreas = new Set(p.localities.map((l) => l.name));
                        const addable = p.areaOptions.filter((a) => !usedAreas.has(a));
                        return (
                            <Card key={i}>
                                <CardContent className="space-y-4 py-5">
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Pincode</Label>
                                            <Input
                                                className="w-32"
                                                value={p.pincode}
                                                inputMode="numeric"
                                                placeholder="6-digit"
                                                onChange={(e) => {
                                                    const v = e.target.value.replace(/\D/gu, "").slice(0, 6);
                                                    setPin(i, { pincode: v });
                                                    if (v.length === 6) void fetchAreas(i, v);
                                                }}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="ml-auto text-destructive"
                                            onClick={() => setActivePins((ps) => ps.filter((_, j) => j !== i))}
                                        >
                                            <Trash2 className="size-4" /> Remove pincode
                                        </Button>
                                    </div>

                                    {p.localities.map((l, li) => (
                                        <div key={li} className="rounded-lg border border-border p-3 space-y-3">
                                            <div className="flex flex-wrap items-end gap-3">
                                                <MapPin className="size-4 text-muted-foreground mb-2.5" />
                                                <span className="text-sm font-medium mb-2">{l.name}</span>
                                                <div className="grid gap-1.5">
                                                    <Label className="text-[11px] text-muted-foreground">Locality first slab (₹)</Label>
                                                    <Input className="h-8 w-24" value={l.baseRupees} inputMode="decimal" placeholder="—" onChange={(e) => setLoc(i, li, { baseRupees: e.target.value })} />
                                                </div>
                                                <div className="grid gap-1.5">
                                                    <Label className="text-[11px] text-muted-foreground">Locality +step (₹)</Label>
                                                    <Input className="h-8 w-24" value={l.addlRupees} inputMode="decimal" placeholder="=first" onChange={(e) => setLoc(i, li, { addlRupees: e.target.value })} />
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="ml-auto size-8"
                                                    onClick={() => setPin(i, { localities: p.localities.filter((_, k) => k !== li) })}
                                                    aria-label="Remove locality"
                                                >
                                                    <Trash2 className="size-3.5 text-destructive" />
                                                </Button>
                                            </div>

                                            <div className="overflow-x-auto rounded-md border border-border/70">
                                                <table className="w-full min-w-[420px] text-sm">
                                                    <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                                                        <tr>
                                                            <th className="w-full px-2 py-1.5 text-left font-medium">Neighbourhood</th>
                                                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">First slab (₹)</th>
                                                            <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">+step (₹)</th>
                                                            <th className="px-1 py-1.5" />
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {l.neighbourhoods.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={4} className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                                                                    No neighbourhoods yet — add the ones you deliver to.
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            l.neighbourhoods.map((n, ni) => (
                                                                <tr key={ni} className="border-t border-border/70">
                                                                    <td className="w-full px-2 py-1">
                                                                        <Input className="h-8 w-full min-w-40" value={n.name} placeholder="e.g. Bazar Line" onChange={(e) => setNb(i, li, ni, { name: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-2 py-1">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={n.baseRupees} inputMode="decimal" placeholder="=locality" onChange={(e) => setNb(i, li, ni, { baseRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-2 py-1">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={n.addlRupees} inputMode="decimal" placeholder="=first" onChange={(e) => setNb(i, li, ni, { addlRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-1 py-1">
                                                                        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setLoc(i, li, { neighbourhoods: l.neighbourhoods.filter((_, m) => m !== ni) })} aria-label="Remove neighbourhood">
                                                                            <Trash2 className="size-3.5 text-destructive" />
                                                                        </Button>
                                                                    </td>
                                                                </tr>
                                                            ))
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setLoc(i, li, { neighbourhoods: [...l.neighbourhoods, { name: "", baseRupees: "", addlRupees: "" }] })}
                                            >
                                                <Plus className="size-4" /> Add neighbourhood
                                            </Button>
                                        </div>
                                    ))}

                                    <div className="flex items-center gap-2">
                                        <Select
                                            value="__pick__"
                                            onValueChange={(v) => {
                                                if (v === "__pick__") return;
                                                setPin(i, { localities: [...p.localities, { name: v, baseRupees: "", addlRupees: "", neighbourhoods: [] }] });
                                            }}
                                            disabled={addable.length === 0}
                                        >
                                            <SelectTrigger className="w-64">
                                                <SelectValue
                                                    placeholder={
                                                        p.areaOptions.length === 0
                                                            ? "Enter pincode to load areas"
                                                            : addable.length === 0
                                                              ? "All areas added"
                                                              : "Add a locality / area"
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-72">
                                                <SelectItem value="__pick__">Add a locality / area…</SelectItem>
                                                {addable.map((a) => (
                                                    <SelectItem key={a} value={a}>{a}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setActivePins((ps) => [...ps, { pincode: "", localities: [], areaOptions: [] }])}
                    >
                        <Plus className="size-4" /> Add pincode
                    </Button>
                </>
            ) : null}

            {/* Live preview — every vehicle's result for one test parcel. */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Calculator className="size-4" /> Rate preview
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="grid gap-1.5">
                            <Label className="text-xs">Weight (g)</Label>
                            <Input className="w-24" value={testGrams} inputMode="numeric" onChange={(e) => setTestGrams(e.target.value)} />
                            <span className="text-[10px] text-muted-foreground tabular-nums">{kgLabel(testGrams)}</span>
                        </div>
                        <div className="grid gap-1.5">
                            <Label className="text-xs">Subtotal (₹)</Label>
                            <Input className="w-24" value={testSubtotal} inputMode="decimal" onChange={(e) => setTestSubtotal(e.target.value)} />
                            <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                        </div>
                        <div className="grid gap-1.5">
                            <Label className="text-xs">To pincode</Label>
                            <Select
                                value={testPincode || "__none__"}
                                onValueChange={(v) => {
                                    setTestPincode(v === "__none__" ? "" : v);
                                    setTestNeighbourhood("");
                                }}
                            >
                                <SelectTrigger className="w-28"><SelectValue placeholder="Pincode" /></SelectTrigger>
                                <SelectContent className="max-h-72">
                                    <SelectItem value="__none__">Pincode…</SelectItem>
                                    {previewPincodes.map((p) => (
                                        <SelectItem key={p} value={p}>{p}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                        </div>
                        <div className="grid gap-1.5">
                            <Label className="text-xs">Neighbourhood</Label>
                            <Select
                                value={testNeighbourhood || "__none__"}
                                onValueChange={(v) => setTestNeighbourhood(v === "__none__" ? "" : v)}
                                disabled={previewNbOptions.length === 0}
                            >
                                <SelectTrigger className="w-44">
                                    <SelectValue placeholder={previewNbOptions.length === 0 ? "Pick a pincode first" : "Select neighbourhood"} />
                                </SelectTrigger>
                                <SelectContent className="max-h-72">
                                    <SelectItem value="__none__">— none —</SelectItem>
                                    {previewNbOptions.map((n) => (
                                        <SelectItem key={n} value={n}>{n}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                        </div>
                    </div>
                    {previewRows == null ? (
                        <p className="text-[11px] text-muted-foreground">Pick a pincode to preview each vehicle&apos;s rate.</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {previewRows.map((r, i) => (
                                <li key={i} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                                    <span className={r.active ? "" : "text-muted-foreground line-through"}>{r.name || "Vehicle"}</span>
                                    {!r.active ? (
                                        <Badge variant="outline">Off</Badge>
                                    ) : r.overWeight ? (
                                        <Badge variant="destructive">Over weight limit</Badge>
                                    ) : r.price == null ? (
                                        <Badge variant="outline">Not covered</Badge>
                                    ) : r.price === 0 ? (
                                        <Badge variant="secondary">FREE</Badge>
                                    ) : (
                                        <span className="font-semibold tabular-nums">{formatRupeesFromPaise(r.price)}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button type="button" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save local couriers"}
                </Button>
            </div>
        </div>
    );
}
