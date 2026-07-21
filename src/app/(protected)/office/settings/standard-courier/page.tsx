"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Calculator, Truck, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import NeighbourhoodEditor from "@/modules/delivery/components/NeighbourhoodEditor";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import {
    computeCustomRatePaise,
    INDIA_STATE_NAMES,
    type CustomConfig,
    type CustomRateMode,
    type CustomServiceLevel,
} from "@/modules/delivery/lib/deliveryMethodConfig";

// Settings → Standard Courier. OUR own courier service (row kind stays CUSTOM).
// It runs multiple SERVICE LEVELS — e.g. Premium and Ordinary — each priced by its
// own rate card: a Flat rate, or a real courier ZONE × WEIGHT matrix (zones matched
// by pincode, base + additional rates per slab, plus a COD surcharge).

type Method = {
    id: number;
    kind: string;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
};

type ZoneForm = {
    name: string;
    prefixes: string;
    states: string[];
    isDefault: boolean;
    baseRupees: string;
    addlRupees: string;
    // RTO (return-to-origin) — charged when a shipment fails delivery and returns.
    // Blank = same as the forward rate (the common case on real rate cards).
    rtoBaseRupees: string;
    rtoAddlRupees: string;
};

// North East + J&K/Ladakh — pre-filled on the standard "North East & J&K" zone.
const NE_JK_STATES = [
    "Assam", "Arunachal Pradesh", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Tripura",
    "Sikkim", "Jammu and Kashmir", "Ladakh",
];
type ServiceForm = {
    name: string;
    isActive: boolean;
    mode: CustomRateMode;
    freeAboveRupees: string;
    codFlatRupees: string;
    codPercent: string;
    flatRupees: string; // FLAT
    baseGrams: string; // ZONE shared slab weights
    stepGrams: string;
    zones: ZoneForm[]; // ZONE matrix
};

const rupees = (paise: unknown) => ((Number(paise) || 0) / 100).toString();
const toPaise = (r: string) => Math.max(0, Math.round((parseFloat(r) || 0) * 100));

// The 5 standard Indian courier zones, pre-filled with example rates (₹, per 0.5 kg).
const STD_ZONES: ZoneForm[] = [
    { name: "Within City", prefixes: "", states: [], isDefault: false, baseRupees: "34", addlRupees: "32", rtoBaseRupees: "", rtoAddlRupees: "" },
    { name: "Within State", prefixes: "", states: [], isDefault: false, baseRupees: "39", addlRupees: "38", rtoBaseRupees: "", rtoAddlRupees: "" },
    { name: "Metro to Metro", prefixes: "", states: [], isDefault: false, baseRupees: "43", addlRupees: "41", rtoBaseRupees: "", rtoAddlRupees: "" },
    { name: "North East & J&K", prefixes: "", states: [...NE_JK_STATES], isDefault: false, baseRupees: "79", addlRupees: "67", rtoBaseRupees: "", rtoAddlRupees: "" },
    { name: "Rest of India", prefixes: "", states: [], isDefault: true, baseRupees: "50", addlRupees: "45", rtoBaseRupees: "", rtoAddlRupees: "" },
];

function newService(i: number): ServiceForm {
    return {
        name: `Service ${i}`,
        isActive: true,
        mode: "FLAT",
        freeAboveRupees: "0",
        codFlatRupees: "0",
        codPercent: "0",
        flatRupees: "99",
        baseGrams: "500",
        stepGrams: "500",
        zones: [],
    };
}

const DEFAULT_SERVICES: ServiceForm[] = [
    { ...newService(1), name: "Ordinary", flatRupees: "60" },
    { ...newService(2), name: "Premium", flatRupees: "120" },
];

function serviceFromCfg(s: CustomServiceLevel): ServiceForm {
    return {
        name: s.name ?? "Service",
        isActive: s.isActive !== false,
        mode: (s.mode as CustomRateMode) ?? "FLAT",
        freeAboveRupees: rupees(s.freeAbovePaise),
        codFlatRupees: rupees(s.codFlatPaise),
        codPercent: String(s.codPercent ?? 0),
        flatRupees: rupees(s.flatPaise) === "0" ? "99" : rupees(s.flatPaise),
        baseGrams: String(s.baseGrams ?? 500),
        stepGrams: String(s.stepGrams ?? 500),
        zones: Array.isArray(s.zones)
            ? s.zones.map((z) => ({
                  name: String(z.name ?? "Zone"),
                  prefixes: Array.isArray(z.pincodePrefixes) ? z.pincodePrefixes.join(", ") : "",
                  states: Array.isArray(z.states) ? z.states : [],
                  isDefault: Boolean(z.isDefault),
                  baseRupees: rupees(z.basePaise),
                  addlRupees: rupees(z.addlPaise),
                  rtoBaseRupees: z.rtoBasePaise ? rupees(z.rtoBasePaise) : "",
                  rtoAddlRupees: z.rtoAddlPaise ? rupees(z.rtoAddlPaise) : "",
              }))
            : [],
    };
}

function serviceToCfg(f: ServiceForm): CustomServiceLevel {
    const base: CustomServiceLevel = {
        name: f.name.trim() || "Service",
        isActive: f.isActive,
        mode: f.mode,
        freeAbovePaise: toPaise(f.freeAboveRupees),
        codFlatPaise: toPaise(f.codFlatRupees),
        codPercent: Number(f.codPercent) || 0,
    };
    if (f.mode === "FLAT") {
        base.flatPaise = toPaise(f.flatRupees);
    } else {
        base.baseGrams = parseInt(f.baseGrams, 10) || 500;
        base.stepGrams = parseInt(f.stepGrams, 10) || 500;
        base.zones = f.zones.map((z) => ({
            name: z.name.trim() || "Zone",
            pincodePrefixes: z.prefixes.split(/[\s,]+/u).map((p) => p.trim()).filter((p) => /^\d{1,6}$/u.test(p)),
            states: z.states,
            isDefault: z.isDefault,
            basePaise: toPaise(z.baseRupees),
            addlPaise: toPaise(z.addlRupees),
            rtoBasePaise: z.rtoBaseRupees.trim() ? toPaise(z.rtoBaseRupees) : undefined,
            rtoAddlPaise: z.rtoAddlRupees.trim() ? toPaise(z.rtoAddlRupees) : undefined,
        }));
    }
    return base;
}

export default function StandardCourierPage() {
    const [method, setMethod] = useState<Method | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);

    const [displayName, setDisplayName] = useState("Standard courier");
    const [services, setServices] = useState<ServiceForm[]>([]);

    // Live preview inputs (shared — prices every active service level).
    const [testGrams, setTestGrams] = useState("1000");
    const [testPincode, setTestPincode] = useState("110001");
    const [testState, setTestState] = useState("");
    const [testSubtotal, setTestSubtotal] = useState("2000");
    const [testCod, setTestCod] = useState(false);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const { data } = await axios.get<{ methods: Method[] }>("/api/settings/couriers");
            const row = data.methods.find((m) => m.kind === "CUSTOM") ?? null;
            if (row) {
                setMethod(row);
                setDisplayName(row.displayName);
                const cfg = (row.configJson ?? {}) as CustomConfig;
                setServices(Array.isArray(cfg.services) ? cfg.services.map(serviceFromCfg) : []);
            }
            setLoaded(true);
        } catch {
            setLoadError(true);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!method) return;
        setSaving(true);
        try {
            const configJson = { ...(method.configJson ?? {}), services: services.map(serviceToCfg) };
            await axios.patch(`/api/settings/couriers/${method.id}`, {
                displayName: displayName.trim() || "Standard courier",
                configJson,
            });
            toast.success("Standard courier saved");
            await load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to save") : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const createRow = async () => {
        setSaving(true);
        try {
            await axios.post("/api/settings/couriers", {
                kind: "CUSTOM",
                displayName: "Standard courier",
                isActive: true,
                sortOrder: 1,
                configJson: { mode: "FLAT", flatPaise: 9900, freeAbovePaise: 0 },
            });
            toast.success("Standard courier created");
            await load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to create") : "Failed to create");
        } finally {
            setSaving(false);
        }
    };

    const setService = (i: number, patch: Partial<ServiceForm>) =>
        setServices((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const setZone = (i: number, zi: number, patch: Partial<ZoneForm>) =>
        setServices((ss) =>
            ss.map((s, j) => (j === i ? { ...s, zones: s.zones.map((z, k) => (k === zi ? { ...z, ...patch } : z)) } : s))
        );
    const toggleZoneState = (i: number, zi: number, st: string) =>
        setServices((ss) =>
            ss.map((s, j) =>
                j === i
                    ? {
                          ...s,
                          zones: s.zones.map((z, k) =>
                              k === zi
                                  ? { ...z, states: z.states.includes(st) ? z.states.filter((x) => x !== st) : [...z.states, st] }
                                  : z
                          ),
                      }
                    : s
            )
        );

    const previews = useMemo(() => {
        const params = {
            weightGrams: parseInt(testGrams, 10) || 0,
            subtotalPaise: toPaise(testSubtotal),
            deliveryPincode: testPincode.trim(),
            deliveryState: testState || undefined,
            cod: testCod,
        };
        return services.map((s) => (s.isActive ? computeCustomRatePaise(serviceToCfg(s), params) : undefined));
    }, [services, testGrams, testSubtotal, testPincode, testState, testCod]);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="max-w-6xl space-y-6 px-6 pt-3 pb-10">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Truck className="size-5" /> Standard Courier
                    </h1>
                    <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                        Our own courier service. Run it with service levels — e.g.{" "}
                        <span className="font-medium">Premium</span> and <span className="font-medium">Ordinary</span> —
                        each with its own rate card: a flat rate, or a zone × weight matrix like a real courier
                        tariff. API couriers (Shiprocket, Delhivery…) price themselves; this page is only for ours.
                    </p>
                </div>

                <Tabs defaultValue="services">
                    <TabsList>
                        <TabsTrigger value="services">Couriers</TabsTrigger>
                        <TabsTrigger value="neighbourhood">Local courier</TabsTrigger>
                    </TabsList>
                    <TabsContent value="services" className="mt-4 space-y-6">

                {loadError ? (
                    <div className="flex max-w-xl items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                        <span className="text-destructive">Couldn&apos;t load the Standard courier.</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
                    </div>
                ) : !loaded ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : !method ? (
                    <Card className="max-w-xl">
                        <CardContent className="py-8 text-center space-y-3">
                            <p className="text-muted-foreground text-sm">No Standard courier exists yet.</p>
                            <Button type="button" onClick={() => void createRow()} disabled={saving}>
                                <Plus className="size-4" /> Create Standard courier
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-medium">Service levels</h2>
                                <p className="text-muted-foreground text-xs">
                                    Each service is its own courier at checkout, shown by its own name.
                                </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => setServices((ss) => [...ss, newService(ss.length + 1)])}>
                                <Plus className="size-4" /> Add service level
                            </Button>
                        </div>

                        {services.length === 0 ? (
                            <Card className="border-dashed">
                                <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                                    <p className="text-muted-foreground text-sm">
                                        No service levels yet. Add one per tier you offer (e.g. Premium, Ordinary),
                                        each with its own rate card.
                                    </p>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setServices(DEFAULT_SERVICES)}>
                                        <Plus className="size-4" /> Add Premium &amp; Ordinary
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : null}

                        {services.map((s, i) => (
                            <Card key={i} className={s.isActive ? "" : "opacity-70"}>
                                <CardContent className="space-y-4 py-5">
                                    {/* Header row: name, active, mode, remove */}
                                    <div className="flex flex-wrap items-center gap-3">
                                        <Input className="max-w-[14rem] font-medium" value={s.name} placeholder="Courier name, e.g. India Post" onChange={(e) => setService(i, { name: e.target.value })} />
                                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Switch checked={s.isActive} onCheckedChange={(v) => setService(i, { isActive: v })} /> Active
                                        </label>
                                        <div className="ml-auto flex items-center gap-2">
                                            <Select value={s.mode} onValueChange={(v) => setService(i, { mode: v as CustomRateMode })}>
                                                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="FLAT">Flat rate</SelectItem>
                                                    <SelectItem value="ZONE">Zone × weight matrix</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button type="button" variant="ghost" size="icon" onClick={() => setServices((ss) => ss.filter((_, j) => j !== i))} aria-label="Remove service">
                                                <Trash2 className="size-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </div>

                                    {s.mode === "FLAT" ? (
                                        <div className="grid gap-3 sm:grid-cols-2 max-w-md">
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Flat rate (₹)</Label>
                                                <Input value={s.flatRupees} inputMode="decimal" onChange={(e) => setService(i, { flatRupees: e.target.value })} />
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Free above ₹ (0 = never)</Label>
                                                <Input value={s.freeAboveRupees} inputMode="decimal" onChange={(e) => setService(i, { freeAboveRupees: e.target.value })} />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {/* Shared slab weights */}
                                            <div className="flex flex-wrap items-end gap-3">
                                                <div className="grid gap-1.5">
                                                    <Label className="text-xs">First slab (g)</Label>
                                                    <Input className="w-28" value={s.baseGrams} inputMode="numeric" onChange={(e) => setService(i, { baseGrams: e.target.value })} />
                                                </div>
                                                <div className="grid gap-1.5">
                                                    <Label className="text-xs">Each additional (g)</Label>
                                                    <Input className="w-32" value={s.stepGrams} inputMode="numeric" onChange={(e) => setService(i, { stepGrams: e.target.value })} />
                                                </div>
                                                <div className="grid gap-1.5">
                                                    <Label className="text-xs">Free above ₹ (0 = never)</Label>
                                                    <Input className="w-32" value={s.freeAboveRupees} inputMode="decimal" onChange={(e) => setService(i, { freeAboveRupees: e.target.value })} />
                                                </div>
                                            </div>

                                            {/* Zone matrix */}
                                            <div className="overflow-x-auto rounded-lg border border-border">
                                                <table className="w-full min-w-[980px] text-sm">
                                                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                                                        <tr>
                                                            <th className="px-3 py-2 text-left font-medium">Zone</th>
                                                            <th className="px-3 py-2 text-left font-medium">States</th>
                                                            <th className="px-3 py-2 text-left font-medium">Pincode prefixes</th>
                                                            <th className="px-3 py-2 text-center font-medium">Default</th>
                                                            <th className="px-3 py-2 text-right font-medium">Fwd first {parseInt(s.baseGrams, 10) || 500}g (₹)</th>
                                                            <th className="px-3 py-2 text-right font-medium">Fwd +{parseInt(s.stepGrams, 10) || 500}g (₹)</th>
                                                            <th className="px-3 py-2 text-right font-medium">RTO first (₹)</th>
                                                            <th className="px-3 py-2 text-right font-medium">RTO +step (₹)</th>
                                                            <th className="px-2 py-2" />
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {s.zones.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={9} className="px-3 py-4 text-center text-xs text-muted-foreground">
                                                                    No zones yet — add the 5 standard zones or a single default zone.
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            s.zones.map((z, zi) => (
                                                                <tr key={zi} className="border-t border-border">
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 min-w-32" value={z.name} onChange={(e) => setZone(i, zi, { name: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <Button type="button" variant="outline" size="sm" className="h-8 min-w-28 justify-between gap-1 font-normal">
                                                                                    {z.states.length > 0 ? `${z.states.length} state${z.states.length > 1 ? "s" : ""}` : "Any / none"}
                                                                                    <ChevronDown className="size-3.5 opacity-60" />
                                                                                </Button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                                                                                {INDIA_STATE_NAMES.map((st) => (
                                                                                    <DropdownMenuCheckboxItem
                                                                                        key={st}
                                                                                        checked={z.states.includes(st)}
                                                                                        onCheckedChange={() => toggleZoneState(i, zi, st)}
                                                                                        onSelect={(e) => e.preventDefault()}
                                                                                    >
                                                                                        {st}
                                                                                    </DropdownMenuCheckboxItem>
                                                                                ))}
                                                                            </DropdownMenuContent>
                                                                        </DropdownMenu>
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 min-w-36" value={z.prefixes} placeholder={z.isDefault ? "(catch-all)" : "e.g. 11, 12"} onChange={(e) => setZone(i, zi, { prefixes: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5 text-center">
                                                                        <Switch checked={z.isDefault} onCheckedChange={(v) => setZone(i, zi, { isDefault: v })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={z.baseRupees} inputMode="decimal" onChange={(e) => setZone(i, zi, { baseRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={z.addlRupees} inputMode="decimal" onChange={(e) => setZone(i, zi, { addlRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={z.rtoBaseRupees} inputMode="decimal" placeholder={z.baseRupees} onChange={(e) => setZone(i, zi, { rtoBaseRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-3 py-1.5">
                                                                        <Input className="h-8 w-24 text-right tabular-nums ml-auto" value={z.rtoAddlRupees} inputMode="decimal" placeholder={z.addlRupees} onChange={(e) => setZone(i, zi, { rtoAddlRupees: e.target.value })} />
                                                                    </td>
                                                                    <td className="px-2 py-1.5">
                                                                        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setService(i, { zones: s.zones.filter((_, k) => k !== zi) })} aria-label="Remove zone">
                                                                            <Trash2 className="size-3.5 text-destructive" />
                                                                        </Button>
                                                                    </td>
                                                                </tr>
                                                            ))
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button type="button" variant="outline" size="sm" onClick={() => setService(i, { zones: [...s.zones, { name: `Zone ${s.zones.length + 1}`, prefixes: "", states: [], isDefault: s.zones.length === 0, baseRupees: "0", addlRupees: "0", rtoBaseRupees: "", rtoAddlRupees: "" }] })}>
                                                    <Plus className="size-4" /> Add zone
                                                </Button>
                                                {s.zones.length === 0 ? (
                                                    <Button type="button" variant="outline" size="sm" onClick={() => setService(i, { zones: STD_ZONES.map((z) => ({ ...z })) })}>
                                                        <Plus className="size-4" /> Add the 5 standard India zones
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    )}

                                    {/* COD surcharge — applies to both modes */}
                                    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-3">
                                        <span className="text-xs font-medium text-muted-foreground">COD surcharge</span>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Flat (₹)</Label>
                                            <Input className="w-24" value={s.codFlatRupees} inputMode="decimal" onChange={(e) => setService(i, { codFlatRupees: e.target.value })} />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">% of order</Label>
                                            <Input className="w-24" value={s.codPercent} inputMode="decimal" onChange={(e) => setService(i, { codPercent: e.target.value })} />
                                        </div>
                                        <span className="text-[11px] text-muted-foreground">
                                            Whichever is higher — flat fee OR % of order value — applies on COD orders (not both added together).
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {/* Shared preview — one parcel, every active service level priced. */}
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
                                        <Input className="w-28" value={testGrams} inputMode="numeric" onChange={(e) => setTestGrams(e.target.value)} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Subtotal (₹)</Label>
                                        <Input className="w-28" value={testSubtotal} inputMode="decimal" onChange={(e) => setTestSubtotal(e.target.value)} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">To pincode</Label>
                                        <Input className="w-32" value={testPincode} inputMode="numeric" placeholder="6-digit" onChange={(e) => setTestPincode(e.target.value.replace(/\D/gu, "").slice(0, 6))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">To state</Label>
                                        <Select value={testState || "__none__"} onValueChange={(v) => setTestState(v === "__none__" ? "" : v)}>
                                            <SelectTrigger className="w-44"><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent className="max-h-72">
                                                <SelectItem value="__none__">Any / none</SelectItem>
                                                {INDIA_STATE_NAMES.map((st) => (
                                                    <SelectItem key={st} value={st}>{st}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
                                        <Switch checked={testCod} onCheckedChange={setTestCod} /> Cash on delivery
                                    </label>
                                </div>
                                <ul className="space-y-1.5">
                                    {services.map((s, i) => (
                                        <li key={i} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                                            <span className={s.isActive ? "" : "text-muted-foreground line-through"}>
                                                {s.name || "Unnamed courier"}
                                                <span className="text-muted-foreground text-xs"> ({s.mode === "ZONE" ? "matrix" : "flat"})</span>
                                            </span>
                                            {!s.isActive ? (
                                                <Badge variant="outline">Off</Badge>
                                            ) : previews[i] == null ? (
                                                <Badge variant="destructive">No zone serves this pincode</Badge>
                                            ) : previews[i] === 0 ? (
                                                <Badge variant="secondary">FREE</Badge>
                                            ) : (
                                                <span className="font-semibold tabular-nums">{formatRupeesFromPaise(previews[i]!)}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-[11px] text-muted-foreground">
                                    Each active service shows as its own courier at checkout, priced by its card.
                                </p>
                            </CardContent>
                        </Card>

                        <div className="flex justify-end">
                            <Button type="button" onClick={() => void save()} disabled={saving}>
                                {saving ? "Saving…" : "Save service levels"}
                            </Button>
                        </div>
                    </>
                )}
                    </TabsContent>
                    <TabsContent value="neighbourhood" className="mt-4">
                        <NeighbourhoodEditor />
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollArea>
    );
}
