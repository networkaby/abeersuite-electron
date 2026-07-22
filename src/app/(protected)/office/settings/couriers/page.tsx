"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Truck, PackageCheck, MapPin, SlidersHorizontal, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    DELIVERY_KINDS,
    DELIVERY_KIND_LABEL,
    INDIA_STATE_NAMES,
    type DeliveryKind,
} from "@/modules/delivery/lib/deliveryMethodConfig";

type Method = {
    id: number;
    kind: DeliveryKind;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    configJson: Record<string, unknown>;
};

type FormState = {
    id: number | null;
    kind: DeliveryKind;
    displayName: string;
    isActive: boolean;
    sortOrder: number;
    // Config, held as strings for the inputs.
    flatRupees: string;
    freeAboveRupees: string;
    pincodes: string;
    pickupLocation: string;
    pickupPincode: string;
    defaultItemWeightGrams: string;
    length: string;
    breadth: string;
    height: string;
    // Availability exclusions (common to every kind).
    excludeStates: string[];
    excludePincodes: string; // prefixes, one per line / comma-separated
};

const rupees = (paise: unknown) => ((Number(paise) || 0) / 100).toString();
const toPaise = (r: string) => Math.max(0, Math.round((parseFloat(r) || 0) * 100));

function emptyForm(kind: DeliveryKind = "OWN_BOY"): FormState {
    return {
        id: null,
        kind,
        displayName: DELIVERY_KIND_LABEL[kind],
        isActive: true,
        sortOrder: 0,
        flatRupees: "0",
        freeAboveRupees: "0",
        pincodes: "",
        pickupLocation: "Primary",
        pickupPincode: "",
        defaultItemWeightGrams: "500",
        length: "15",
        breadth: "15",
        height: "10",
        excludeStates: [],
        excludePincodes: "",
    };
}

export default function CouriersSettingsPage() {
    const [methods, setMethods] = useState<Method[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState<FormState>(emptyForm());
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const { data } = await axios.get<{ methods: Method[] }>("/api/settings/couriers");
            setMethods(data.methods);
            setLoaded(true);
        } catch {
            setLoadError(true);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const openCreate = () => { setForm(emptyForm()); setDialogOpen(true); };
    const openEdit = (m: Method) => {
        const c = m.configJson ?? {};
        const ex = (c.exclude ?? {}) as { states?: unknown; pincodePrefixes?: unknown };
        setForm({
            id: m.id,
            kind: m.kind,
            displayName: m.displayName,
            isActive: m.isActive,
            sortOrder: m.sortOrder,
            flatRupees: rupees(c.flatPaise),
            freeAboveRupees: rupees(c.freeAbovePaise),
            pincodes: Array.isArray(c.pincodes) ? (c.pincodes as string[]).join("\n") : "",
            pickupLocation: String(c.pickupLocation ?? "Primary"),
            pickupPincode: String(c.pickupPincode ?? ""),
            defaultItemWeightGrams: String(c.defaultItemWeightGrams ?? 500),
            length: String(c.length ?? 15),
            breadth: String(c.breadth ?? 15),
            height: String(c.height ?? 10),
            excludeStates: Array.isArray(ex.states) ? (ex.states as string[]) : [],
            excludePincodes: Array.isArray(ex.pincodePrefixes) ? (ex.pincodePrefixes as string[]).join("\n") : "",
        });
        setDialogOpen(true);
    };

    const buildConfig = (): Record<string, unknown> => {
        if (form.kind === "CUSTOM") {
            return { flatPaise: toPaise(form.flatRupees), freeAbovePaise: toPaise(form.freeAboveRupees) };
        }
        if (form.kind === "OWN_BOY") {
            // Fresh local-boy row — matrix-ready scaffold. Pricing + coverage are
            // then set on the Standard Courier → Local courier tab (no flat rate).
            return { pincodes: [], flatPaise: 0, freeAbovePaise: 0, baseGrams: 500, stepGrams: 500, neighbourhoods: {} };
        }
        return {
            pickupLocation: form.pickupLocation.trim(),
            pickupPincode: form.pickupPincode.trim(),
            defaultItemWeightGrams: parseInt(form.defaultItemWeightGrams, 10) || 500,
            length: parseInt(form.length, 10) || 15,
            breadth: parseInt(form.breadth, 10) || 15,
            height: parseInt(form.height, 10) || 10,
        };
    };

    const buildExclude = (): { states: string[]; pincodePrefixes: string[] } => ({
        states: form.excludeStates,
        pincodePrefixes: form.excludePincodes
            .split(/[\s,]+/u)
            .map((p) => p.trim())
            .filter((p) => /^\d{1,6}$/u.test(p)),
    });

    const save = async () => {
        if (!form.displayName.trim()) { toast.error("Display name is required"); return; }
        setSaving(true);
        // For a Custom courier / local boy EDIT, the rate card + coverage live on the
        // Standard Courier page — so preserve the stored config and only fold in the
        // exclusions edited here. Create (and Shiprocket) build config from the form.
        const preserveRates = (form.kind === "CUSTOM" || form.kind === "OWN_BOY") && form.id != null;
        const baseCfg = preserveRates
            ? { ...(methods.find((m) => m.id === form.id)?.configJson ?? {}) }
            : buildConfig();
        const configJson = { ...baseCfg, exclude: buildExclude() };
        const payload = {
            kind: form.kind,
            displayName: form.displayName.trim(),
            isActive: form.isActive,
            sortOrder: form.sortOrder,
            configJson,
        };
        try {
            if (form.id == null) {
                await axios.post("/api/settings/couriers", payload);
                toast.success("Courier added");
            } else {
                const { kind: _k, ...patch } = payload;
                void _k;
                await axios.patch(`/api/settings/couriers/${form.id}`, patch);
                toast.success("Courier updated");
            }
            setDialogOpen(false);
            await load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to save") : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (m: Method) => {
        if (!window.confirm(`Delete "${m.displayName}"?`)) return;
        try {
            await axios.delete(`/api/settings/couriers/${m.id}`);
            toast.success("Courier deleted");
            await load();
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to delete") : "Failed to delete");
        }
    };

    const summary = (m: Method): string => {
        const c = m.configJson ?? {};
        if (m.kind === "CUSTOM") {
            const svcs = Array.isArray(c.services) ? c.services.length : 0;
            if (svcs > 0) return `${svcs} service level(s)`;
            const mode = String(c.mode ?? "FLAT");
            if (mode === "ZONE") return `Rate card · ${Array.isArray(c.zones) ? c.zones.length : 0} zone(s)`;
            return `Rate card · flat ₹${rupees(c.flatPaise)}`;
        }
        if (m.kind === "OWN_BOY") {
            const nb = (c.neighbourhoods ?? {}) as Record<string, unknown>;
            const areas = Object.values(nb).reduce<number>((sum, locs) => sum + Object.keys((locs ?? {}) as object).length, 0);
            return areas > 0 ? `${areas} area(s) covered · matrix` : "No coverage yet";
        }
        return `Pickup ${c.pickupPincode || "—"} · ${c.defaultItemWeightGrams ?? 500}g default`;
    };

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold">Couriers</h1>
                        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                            The delivery options a customer can pick at checkout. The chosen courier&apos;s
                            rate becomes the order&apos;s shipping charge. Shiprocket rates are fetched live by
                            parcel weight; the local boy is offered only for the pincodes you list. Shiprocket
                            API keys live in environment variables — only non-secret pickup config is set here.
                        </p>
                    </div>
                    <Button type="button" onClick={openCreate} disabled={!loaded}>
                        <Plus className="mr-1 size-4" /> Add courier
                    </Button>
                </div>

                {loadError ? (
                    <div className="flex max-w-xl items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                        <span className="text-destructive">Couldn&apos;t load couriers.</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
                    </div>
                ) : !loaded ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : methods.length === 0 ? (
                    <Card className="max-w-xl">
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground text-sm">No couriers configured yet.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3">
                        {methods.map((m) => (
                            <Card key={m.id} className="max-w-3xl">
                                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                                    <div className="min-w-40 flex-1">
                                        <div className="flex items-center gap-2">
                                            {m.kind === "SHIPROCKET" || m.kind === "SHIPWAY" ? <Truck className="size-4" /> : m.kind === "OWN_BOY" ? <MapPin className="size-4" /> : <PackageCheck className="size-4" />}
                                            <span className="font-medium">{m.displayName}</span>
                                            {!m.isActive && <Badge className="bg-muted text-muted-foreground">Inactive</Badge>}
                                        </div>
                                        <span className="text-muted-foreground text-xs">
                                            {DELIVERY_KIND_LABEL[m.kind]} · {summary(m)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {m.kind === "CUSTOM" ? (
                                            <Button type="button" variant="outline" size="sm" asChild>
                                                <Link href="/office/settings/standard-courier">
                                                    <SlidersHorizontal className="size-4" /> Manage
                                                </Link>
                                            </Button>
                                        ) : null}
                                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(m)} aria-label="Edit">
                                            <Pencil className="size-4" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => void remove(m)} aria-label="Delete">
                                            <Trash2 className="size-4 text-destructive" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{form.id == null ? "Add courier" : "Edit courier"}</DialogTitle>
                        <DialogDescription>
                            {form.kind === "SHIPROCKET" || form.kind === "SHIPWAY"
                                ? `${DELIVERY_KIND_LABEL[form.kind]} API keys are set in environment variables — only pickup config is entered here.`
                                : form.kind === "CUSTOM"
                                  ? "Your own courier. Name & visibility here; pricing lives on the rate card."
                                  : "The in-house delivery boy. Name & visibility here; coverage and per-neighbourhood rates live on the Local courier tab."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid gap-1.5">
                            <Label>Kind</Label>
                            <Select
                                value={form.kind}
                                onValueChange={(v) => setForm((f) => ({ ...f, kind: v as DeliveryKind }))}
                                disabled={form.id != null}
                            >
                                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DELIVERY_KINDS.map((k) => (
                                        <SelectItem key={k} value={k}>{DELIVERY_KIND_LABEL[k]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-1.5">
                            <Label htmlFor="c-name">Display name</Label>
                            <Input id="c-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
                        </div>

                        {form.kind === "OWN_BOY" ? (
                            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                                {form.id == null ? (
                                    "After saving, set the coverage areas and per-neighbourhood weight rates on the Standard Courier → Local courier tab."
                                ) : (
                                    <span className="flex items-center justify-between gap-2">
                                        Coverage &amp; per-neighbourhood rates are set on the Local courier tab.
                                        <Link href="/office/settings/standard-courier" className="text-primary underline">
                                            Open →
                                        </Link>
                                    </span>
                                )}
                            </div>
                        ) : null}

                        {form.kind === "CUSTOM" ? (
                            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                                {form.id == null ? (
                                    "This is our own courier — after saving, manage its service levels & rates on the Standard Courier page."
                                ) : (
                                    <span className="flex items-center justify-between gap-2">
                                        Pricing &amp; service levels are set on the Standard Courier page.
                                        <Link href="/office/settings/standard-courier" className="text-primary underline">
                                            Open →
                                        </Link>
                                    </span>
                                )}
                            </div>
                        ) : null}

                        {form.kind === "SHIPROCKET" || form.kind === "SHIPWAY" ? (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label>Pickup location (nickname)</Label>
                                        <Input value={form.pickupLocation} onChange={(e) => setForm((f) => ({ ...f, pickupLocation: e.target.value }))} placeholder="Primary" />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label>Pickup pincode</Label>
                                        <Input value={form.pickupPincode} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, pickupPincode: e.target.value.replace(/\D/gu, "").slice(0, 6) }))} placeholder="6-digit origin" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label>Wt (g)</Label>
                                        <Input value={form.defaultItemWeightGrams} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, defaultItemWeightGrams: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label>L (cm)</Label>
                                        <Input value={form.length} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label>B (cm)</Label>
                                        <Input value={form.breadth} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, breadth: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label>H (cm)</Label>
                                        <Input value={form.height} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))} />
                                    </div>
                                </div>
                                <p className="text-muted-foreground text-[11px]">
                                    {form.kind === "SHIPWAY" ? (
                                        <>
                                            Set <code>SHIPWAY_USERNAME</code> (your Shipway email) and{" "}
                                            <code>SHIPWAY_LICENSE</code> (License Key) for live rates. Without them,
                                            Shipway is skipped at checkout.
                                        </>
                                    ) : (
                                        <>
                                            Set <code>SHIPROCKET_EMAIL</code> / <code>SHIPROCKET_PASSWORD</code> in the
                                            environment for live rates. Without them, Shiprocket is skipped at checkout.
                                        </>
                                    )}
                                </p>
                            </>
                        ) : null}

                        {/* Availability exclusions — hide this courier for some destinations. */}
                        <div className="rounded-md border border-border p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm">Don&apos;t offer this courier to…</Label>
                                {(form.excludeStates.length > 0 || form.excludePincodes.trim()) ? (
                                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                                        onClick={() => setForm((f) => ({ ...f, excludeStates: [], excludePincodes: "" }))}>
                                        Clear
                                    </Button>
                                ) : null}
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs text-muted-foreground">Excluded states</Label>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className="w-full justify-between gap-1 font-normal">
                                            {form.excludeStates.length > 0 ? `${form.excludeStates.length} state${form.excludeStates.length > 1 ? "s" : ""} excluded` : "None"}
                                            <ChevronDown className="size-3.5 opacity-60" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                                        {INDIA_STATE_NAMES.map((st) => (
                                            <DropdownMenuCheckboxItem
                                                key={st}
                                                checked={form.excludeStates.includes(st)}
                                                onCheckedChange={() =>
                                                    setForm((f) => ({
                                                        ...f,
                                                        excludeStates: f.excludeStates.includes(st)
                                                            ? f.excludeStates.filter((x) => x !== st)
                                                            : [...f.excludeStates, st],
                                                    }))
                                                }
                                                onSelect={(e) => e.preventDefault()}
                                            >
                                                {st}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="grid gap-1.5">
                                <Label className="text-xs text-muted-foreground">Excluded pincodes (prefixes)</Label>
                                <textarea
                                    className="border-input bg-background flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    value={form.excludePincodes}
                                    placeholder="One prefix per line, e.g. 78 (all 78xxxx) or 781301"
                                    onChange={(e) => setForm((f) => ({ ...f, excludePincodes: e.target.value }))}
                                />
                                <p className="text-muted-foreground text-[11px]">
                                    A destination whose state or pincode-prefix matches won&apos;t see this courier at checkout.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Priority</Label>
                                <Input value={String(form.sortOrder)} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))} />
                                <p className="text-muted-foreground text-[11px]">Lower = higher priority (shown first).</p>
                            </div>
                            <div className="flex items-start justify-between rounded-md border border-border px-3 py-2">
                                <Label htmlFor="c-active" className="font-normal">Active</Label>
                                <Switch id="c-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                        <Button type="button" onClick={() => void save()} disabled={saving}>
                            {saving ? "Saving…" : form.id == null ? "Add" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ScrollArea>
    );
}
