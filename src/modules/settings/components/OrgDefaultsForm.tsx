"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { invalidateOrgDefaultsCache } from "@/shared/lib/orgDefaults";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface InvUnit {
    id: number;
    code: string;
    label: string;
    isActive: boolean;
}

interface GstRateOpt {
    id: number;
    rate: string | number;
    label: string;
    isActive: boolean;
}

interface BarcodeBand {
    max: number;
    add: number;
    hint: number;
}

interface OrgDefaults {
    id: number;
    defaultUnitId: number | null;
    defaultGstRateId: number | null;
    defaultHsnCode: string | null;
    defaultTaxability: string | null;
    valuationMethod: string;
    defaultSaleCreditPeriod: number | null;
    defaultPurchaseCreditPeriod: number | null;
    defaultCurrencySymbol: string;
    barcodeBandsJson: BarcodeBand[];
}

const digitsOnly = (s: string): string => s.replace(/\D/g, "");

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE", label: "Taxable" },
    { value: "EXEMPT", label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST", label: "Non-GST" },
];

const VALUATION_OPTIONS = [
    { value: "WEIGHTED_AVG", label: "Weighted Average" },
    { value: "SIMPLE_AVG",   label: "Simple Average" },
    { value: "FIFO",         label: "FIFO" },
    { value: "LAST_INWARD",  label: "Last Inward" },
    { value: "MONTHLY_AVG",  label: "Monthly Average" },
];

const NONE = "__none__";

export function OrgDefaultsForm({ units }: { units: InvUnit[] }) {
    const [data, setData] = useState<OrgDefaults | null>(null);
    const [draft, setDraft] = useState<OrgDefaults | null>(null);
    const [gstRates, setGstRates] = useState<GstRateOpt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([
            axios.get<OrgDefaults>("/api/settings/org-defaults"),
            axios.get<GstRateOpt[]>("/api/inventory/gst-rates"),
        ])
            .then(([defaultsRes, ratesRes]) => {
                const od: OrgDefaults = {
                    ...defaultsRes.data,
                    barcodeBandsJson: Array.isArray(defaultsRes.data.barcodeBandsJson)
                        ? defaultsRes.data.barcodeBandsJson
                        : [],
                };
                setData(od);
                setDraft(od);
                setGstRates(ratesRes.data);
            })
            .catch(() => toast.error("Failed to load org defaults"))
            .finally(() => setLoading(false));
    }, []);

    function set<K extends keyof OrgDefaults>(key: K, value: OrgDefaults[K]) {
        setDraft((d) => d && { ...d, [key]: value });
    }

    // ── Barcode bands editor helpers ──────────────────────────────────────────
    const bands = draft?.barcodeBandsJson ?? [];
    const setBand = (i: number, key: keyof BarcodeBand, raw: string) =>
        setDraft((d) => {
            if (!d) return d;
            const next = [...(d.barcodeBandsJson ?? [])];
            next[i] = { ...next[i], [key]: Number(digitsOnly(raw) || "0") };
            return { ...d, barcodeBandsJson: next };
        });
    const addBand = () =>
        setDraft((d) => d && { ...d, barcodeBandsJson: [...(d.barcodeBandsJson ?? []), { max: 0, add: 0, hint: 0 }] });
    const removeBand = (i: number) =>
        setDraft((d) => d && { ...d, barcodeBandsJson: (d.barcodeBandsJson ?? []).filter((_, idx) => idx !== i) });

    async function handleSave() {
        if (!draft) return;
        setSaving(true);
        try {
            const payload = {
                defaultUnitId: draft.defaultUnitId,
                defaultGstRateId: draft.defaultGstRateId,
                defaultHsnCode: draft.defaultHsnCode,
                defaultTaxability: draft.defaultTaxability,
                valuationMethod: draft.valuationMethod,
                defaultSaleCreditPeriod: draft.defaultSaleCreditPeriod,
                defaultPurchaseCreditPeriod: draft.defaultPurchaseCreditPeriod,
                defaultCurrencySymbol: draft.defaultCurrencySymbol,
                // Sorted ascending by `max` so barcodePrice's `find(price <= max)` picks the right band.
                barcodeBandsJson: [...(draft.barcodeBandsJson ?? [])]
                    .filter((b) => b.max > 0)
                    .sort((a, b) => a.max - b.max),
            };
            const { data: saved } = await axios.patch<OrgDefaults>("/api/settings/org-defaults", payload);
            setData(saved);
            setDraft(saved);
            invalidateOrgDefaultsCache();
            toast.success("Org defaults saved");
        } catch (err) {
            const msg = axios.isAxiosError(err) ? err.response?.data?.error : null;
            toast.error(msg ?? "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    const dirty = JSON.stringify(draft) !== JSON.stringify(data);

    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (!draft) return <p className="text-sm text-destructive">Failed to load settings.</p>;

    const activeUnits = units.filter((u) => u.isActive);

    return (
        <div className="space-y-6">
            {/* Product defaults */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Product defaults</h2>
                    <p className="text-xs text-muted-foreground">Pre-filled when creating a new product.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Default unit</Label>
                        <Select
                            value={draft.defaultUnitId != null ? String(draft.defaultUnitId) : NONE}
                            onValueChange={(v) => set("defaultUnitId", v === NONE ? null : Number(v))}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>None</SelectItem>
                                {activeUnits.map((u) => (
                                    <SelectItem key={u.id} value={String(u.id)}>
                                        {u.code} — {u.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Default taxability</Label>
                        <Select
                            value={draft.defaultTaxability ?? NONE}
                            onValueChange={(v) => set("defaultTaxability", v === NONE ? null : v)}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>None</SelectItem>
                                {TAXABILITY_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Default GST rate</Label>
                        <Select
                            value={draft.defaultGstRateId != null ? String(draft.defaultGstRateId) : NONE}
                            onValueChange={(v) => set("defaultGstRateId", v === NONE ? null : Number(v))}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>None</SelectItem>
                                {gstRates.filter((r) => r.isActive).map((r) => (
                                    <SelectItem key={r.id} value={String(r.id)}>
                                        {r.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">Final fallback when product and group have no GST.</p>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Default HSN code</Label>
                        <Input
                            className="h-9"
                            placeholder="e.g. 8528"
                            maxLength={8}
                            value={draft.defaultHsnCode ?? ""}
                            onChange={(e) => set("defaultHsnCode", e.target.value || null)}
                        />
                    </div>
                </div>
            </section>

            {/* Stock valuation default */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Stock valuation method</h2>
                    <p className="text-xs text-muted-foreground">
                        Drives the Balance Sheet closing stock, stock-summary, and
                        pricing fallback when a product or strategy doesn&apos;t pick its own method.
                        BS / stock-summary pages can preview other methods without changing this default.
                    </p>
                </div>

                <div className="max-w-[260px] space-y-1">
                    <Label className="text-xs">Default method</Label>
                    <Select
                        value={draft.valuationMethod}
                        onValueChange={(v) => set("valuationMethod", v)}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {VALUATION_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </section>

            {/* Voucher defaults */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Credit period defaults</h2>
                    <p className="text-xs text-muted-foreground">Number of days until payment is due on credit vouchers.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Sale credit period (days)</Label>
                        <Input
                            type="text"
                            className="h-9"
                            placeholder="e.g. 30"
                            value={draft.defaultSaleCreditPeriod ?? ""}
                            onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, "");
                                set("defaultSaleCreditPeriod", v === "" ? null : Number(v));
                            }}
                        />
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Purchase credit period (days)</Label>
                        <Input
                            type="text"
                            className="h-9"
                            placeholder="e.g. 45"
                            value={draft.defaultPurchaseCreditPeriod ?? ""}
                            onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, "");
                                set("defaultPurchaseCreditPeriod", v === "" ? null : Number(v));
                            }}
                        />
                    </div>
                </div>
            </section>

            {/* Currency */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Currency</h2>
                    <p className="text-xs text-muted-foreground">
                        Symbol shown before amounts — use ₹, Rs., INR, $, USD, or any label.
                    </p>
                </div>

                <div className="max-w-[160px] space-y-1">
                    <Label className="text-xs">Currency symbol</Label>
                    <Input
                        className="h-9"
                        maxLength={8}
                        placeholder="₹"
                        value={draft.defaultCurrencySymbol}
                        onChange={(e) => set("defaultCurrencySymbol", e.target.value)}
                    />
                </div>
            </section>

            {/* Barcode price bands */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Barcode price bands</h2>
                    <p className="text-xs text-muted-foreground">
                        Used by <span className="font-medium">Update &amp; Print Labels</span>. For a Sale Price up to
                        <span className="font-mono"> Max ₹</span>, the printed barcode price is the Sale Price plus
                        <span className="font-mono"> Add ₹</span> (rounded to the nearest 10), with the
                        <span className="font-mono"> Hint</span> digit set as the units digit so staff can read which band applied.
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span>Up to Max ₹</span>
                        <span>Add ₹</span>
                        <span>Hint digit (0–9)</span>
                        <span className="w-8" />
                    </div>
                    {bands.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground">
                            No bands — the barcode price falls back to the Sale Price (no buffer). Click Add band.
                        </p>
                    ) : null}
                    {bands.map((b, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                            <Input
                                inputMode="numeric"
                                className="h-8 text-right font-mono text-xs"
                                placeholder="0"
                                value={b.max ? String(b.max) : ""}
                                onChange={(e) => setBand(i, "max", e.target.value)}
                            />
                            <Input
                                inputMode="numeric"
                                className="h-8 text-right font-mono text-xs"
                                placeholder="0"
                                value={b.add ? String(b.add) : ""}
                                onChange={(e) => setBand(i, "add", e.target.value)}
                            />
                            <Input
                                inputMode="numeric"
                                className="h-8 text-right font-mono text-xs"
                                placeholder="0"
                                maxLength={1}
                                value={b.hint ? String(b.hint) : ""}
                                onChange={(e) => setBand(i, "hint", e.target.value.slice(0, 1))}
                            />
                            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove band" onClick={() => removeBand(i)}>
                                <Trash2 className="size-4 text-muted-foreground" />
                            </Button>
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={addBand}>
                        <Plus className="size-4" /> Add band
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                        Bands are sorted by Max on save; the first band whose Max ≥ the Sale Price applies.
                    </p>
                </div>
            </section>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                    <Save className="mr-1.5 size-3.5" />
                    {saving ? "Saving…" : "Save defaults"}
                </Button>
            </div>
        </div>
    );
}
