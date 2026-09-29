"use client";

import { useCallback, useEffect, useState } from "react";
import { GatedLink } from "@/shared/components/GatedLink";
import axios from "axios";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { toast } from "sonner";
import { Pencil, Truck, PackageCheck, MapPin, SlidersHorizontal, ChevronDown, Store, Gift } from "lucide-react";
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
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
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
    // Store pickup: customer-facing note (store address / timings).
    pickupNote: string;
    // Free delivery serve list — where it IS offered (empty = nowhere).
    includeStates: string[];
    includePincodes: string; // prefixes, one per line / comma-separated
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
        pickupNote: "",
        includeStates: [],
        includePincodes: "",
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

    // Courier setup is shared config — a rate or a service added elsewhere
    // announces `settings`.
    useRealtimeTopics(["settings"], () => { void load(); });

    const openEdit = (m: Method) => {
        const c = m.configJson ?? {};
        const ex = (c.exclude ?? {}) as { states?: unknown; pincodePrefixes?: unknown };
        const inc = (c.include ?? {}) as { states?: unknown; pincodePrefixes?: unknown };
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
            pickupNote: String(c.note ?? ""),
            includeStates: Array.isArray(inc.states) ? (inc.states as string[]) : [],
            includePincodes: Array.isArray(inc.pincodePrefixes) ? (inc.pincodePrefixes as string[]).join("\n") : "",
            excludeStates: Array.isArray(ex.states) ? (ex.states as string[]) : [],
            excludePincodes: Array.isArray(ex.pincodePrefixes) ? (ex.pincodePrefixes as string[]).join("\n") : "",
        });
        setDialogOpen(true);
    };

    const parsePrefixes = (raw: string): string[] =>
        raw
            .split(/[\s,]+/u)
            .map((p) => p.trim())
            .filter((p) => /^\d{1,6}$/u.test(p));

    const buildConfig = (): Record<string, unknown> => {
        if (form.kind === "CUSTOM") {
            return { flatPaise: toPaise(form.flatRupees), freeAbovePaise: toPaise(form.freeAboveRupees) };
        }
        if (form.kind === "OWN_BOY") {
            // Fresh local-boy row — matrix-ready scaffold. Pricing + coverage are
            // then set on the Standard Courier → Local courier tab (no flat rate).
            return { pincodes: [], flatPaise: 0, freeAbovePaise: 0, baseGrams: 500, stepGrams: 500, neighbourhoods: {} };
        }
        if (form.kind === "STORE_PICKUP") {
            // Always ₹0 — pickup note + optional serve area (empty = everywhere).
            return {
                note: form.pickupNote.trim(),
                include: { states: form.includeStates, pincodePrefixes: parsePrefixes(form.includePincodes) },
            };
        }
        if (form.kind === "FREE_DELIVERY") {
            // Serve list — where free delivery IS offered (empty = nowhere).
            return { include: { states: form.includeStates, pincodePrefixes: parsePrefixes(form.includePincodes) } };
        }
        return {
            pickupLocation: form.pickupLocation.trim(),
            pickupPincode: form.pickupPincode.trim(),
        };
    };

    const buildExclude = (): { states: string[]; pincodePrefixes: string[] } => ({
        states: form.excludeStates,
        pincodePrefixes: parsePrefixes(form.excludePincodes),
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
        if (m.kind === "STORE_PICKUP" || m.kind === "FREE_DELIVERY") {
            const inc = (c.include ?? {}) as { states?: unknown; pincodePrefixes?: unknown };
            const st = Array.isArray(inc.states) ? inc.states.length : 0;
            const px = Array.isArray(inc.pincodePrefixes) ? inc.pincodePrefixes.length : 0;
            const parts = [st > 0 ? `${st} state(s)` : null, px > 0 ? `${px} pincode prefix(es)` : null].filter(Boolean);
            const serve = parts.length > 0 ? `serves ${parts.join(" + ")}` : null;
            if (m.kind === "FREE_DELIVERY") return serve ? `₹0 · ${serve}` : "No serve area yet — offered nowhere";
            const note = String(c.note ?? "").trim() ? "pickup note set" : "no pickup note yet";
            return `₹0 · ${serve ?? "offered everywhere"} · ${note}`;
        }
        return `Pickup ${c.pickupPincode || "—"}`;
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
                            parcel weight; the local boy is offered only for the pincodes you list. Pickup from
                            store and Free delivery are always ₹0 — free delivery only inside its serve area.
                            Shiprocket API keys live in environment variables — only non-secret pickup config is set here.
                        </p>
                    </div>
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
                                            {m.kind === "SHIPROCKET" || m.kind === "SHIPWAY" ? <Truck className="size-4" /> : m.kind === "OWN_BOY" ? <MapPin className="size-4" /> : m.kind === "STORE_PICKUP" ? <Store className="size-4" /> : m.kind === "FREE_DELIVERY" ? <Gift className="size-4" /> : <PackageCheck className="size-4" />}
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
                                                <GatedLink href="/office/settings/standard-courier">
                                                    <SlidersHorizontal className="size-4" /> Manage
                                                </GatedLink>
                                            </Button>
                                        ) : null}
                                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(m)} aria-label="Edit">
                                            <Pencil className="size-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-[73rem] max-h-[85vh] grid-rows-[auto_1fr_auto]">
                    <DialogHeader>
                        <DialogTitle>{form.displayName}</DialogTitle>
                        {/* <DialogDescription>
                            {form.kind === "SHIPROCKET" || form.kind === "SHIPWAY"
                                ? `${DELIVERY_KIND_LABEL[form.kind]} API keys are set in environment variables — only pickup config is entered here.`
                                : form.kind === "CUSTOM"
                                    ? "Your own courier. Name & visibility here; pricing lives on the rate card."
                                    : "The in-house delivery boy. Name & visibility here; coverage and per-neighbourhood rates live on the Local courier tab."}
                        </DialogDescription> */}
                    </DialogHeader>

                    <div className="space-y-4 overflow-y-auto min-h-0 -mr-4 pr-4">
                        {/* Courier names are fixed by the hard-coded catalog (shown in the title) —
                            not editable here. The modal only edits config: coverage/pickup,
                            exclusions, priority, active. */}
                        {form.kind === "OWN_BOY" ? (
                            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                                {form.id == null ? (
                                    "After saving, set the coverage areas and per-neighbourhood weight rates on the Standard Courier → Local courier tab."
                                ) : (
                                    <span className="flex items-center justify-between gap-2">
                                        Coverage &amp; per-neighbourhood rates are set on the Local courier tab.
                                        <GatedLink href="/office/settings/standard-courier" className="text-primary underline">
                                            Open →
                                        </GatedLink>
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
                                        <GatedLink href="/office/settings/standard-courier" className="text-primary underline">
                                            Open →
                                        </GatedLink>
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

                        {form.kind === "STORE_PICKUP" ? (
                            <div className="grid gap-1.5">
                                <Label>Pickup note (shown to the customer)</Label>
                                <textarea
                                    className="border-input bg-background flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                    value={form.pickupNote}
                                    placeholder="e.g. Collect from Network Service, G.S. Road, 11am–8pm (Mon–Sat)"
                                    onChange={(e) => setForm((f) => ({ ...f, pickupNote: e.target.value }))}
                                />
                                <p className="text-muted-foreground text-[11px]">
                                    Always ₹0 — the customer collects the order from the store. This note (address / timings) shows under the option at checkout.
                                </p>
                            </div>
                        ) : null}

                        {form.kind === "FREE_DELIVERY" || form.kind === "STORE_PICKUP" ? (
                            <div className="rounded-md border border-border p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm">
                                        {form.kind === "FREE_DELIVERY"
                                            ? "Offer free delivery to… (serve area)"
                                            : "Offer store pickup to… (serve area)"}
                                    </Label>
                                    {(form.includeStates.length > 0 || form.includePincodes.trim()) ? (
                                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                                            onClick={() => setForm((f) => ({ ...f, includeStates: [], includePincodes: "" }))}>
                                            Clear
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs text-muted-foreground">Served states</Label>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button type="button" variant="outline" size="sm" className="w-full justify-between gap-1 font-normal">
                                                {form.includeStates.length > 0 ? `${form.includeStates.length} state${form.includeStates.length > 1 ? "s" : ""} served` : "None"}
                                                <ChevronDown className="size-3.5 opacity-60" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                                            {INDIA_STATE_NAMES.map((st) => (
                                                <DropdownMenuCheckboxItem
                                                    key={st}
                                                    checked={form.includeStates.includes(st)}
                                                    onCheckedChange={() =>
                                                        setForm((f) => ({
                                                            ...f,
                                                            includeStates: f.includeStates.includes(st)
                                                                ? f.includeStates.filter((x) => x !== st)
                                                                : [...f.includeStates, st],
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
                                    <Label className="text-xs text-muted-foreground">Served pincodes (prefixes)</Label>
                                    <textarea
                                        className="border-input bg-background flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                        value={form.includePincodes}
                                        placeholder="One prefix per line, e.g. 781 (all 781xxx) or 781301"
                                        onChange={(e) => setForm((f) => ({ ...f, includePincodes: e.target.value }))}
                                    />
                                    <p className="text-muted-foreground text-[11px]">
                                        {form.kind === "FREE_DELIVERY" ? (
                                            <>
                                                Free delivery (₹0) is offered ONLY where a served state or pincode-prefix matches.
                                                Empty serve area = offered nowhere. Use the exclusions below to block pockets inside
                                                a served state (e.g. serve Assam, block 7844).
                                            </>
                                        ) : (
                                            <>
                                                Empty serve area = pickup offered everywhere. Add states / pincode-prefixes to offer
                                                pickup only to nearby customers. Use the exclusions below to block pockets inside a
                                                served area.
                                            </>
                                        )}
                                    </p>
                                </div>
                            </div>
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
                            <div className="grid gap-1.5 self-start">
                                <Label htmlFor="c-active">Active</Label>
                                <div className="flex h-9 items-center">
                                    <Switch id="c-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
                                </div>
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
