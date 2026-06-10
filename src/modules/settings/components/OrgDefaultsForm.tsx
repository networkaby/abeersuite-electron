"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { extractApiError } from "@/shared/lib/api";
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
import { Switch } from "@/components/ui/switch";
import {
    DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY,
    ESTIMATE_DISCOUNT_LABELS,
    normalizeEstimateDiscountVisibility,
    type EstimateDiscountVisibility,
} from "@/modules/pos/lib/discountVisibility";

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

interface AccountGroupOpt {
    id: number;
    name: string;
    type: string;
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
    cashDenominationsJson: number[];
    shippingPoolGroupId: number | null;
    posEstimateShowDiscountsJson: EstimateDiscountVisibility;
}

const digitsOnly = (s: string): string => s.replace(/\D/g, "");

// Fallback shown if the row has none; also the "Reset to defaults" target.
const DEFAULT_CASH_DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

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
    const [accountGroups, setAccountGroups] = useState<AccountGroupOpt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([
            axios.get<OrgDefaults>("/api/settings/org-defaults"),
            axios.get<GstRateOpt[]>("/api/inventory/gst-rates"),
            axios.get<AccountGroupOpt[]>("/api/settings/account-groups").catch(() => ({ data: [] as AccountGroupOpt[] })),
        ])
            .then(([defaultsRes, ratesRes, groupsRes]) => {
                setAccountGroups(groupsRes.data);
                const od: OrgDefaults = {
                    ...defaultsRes.data,
                    barcodeBandsJson: Array.isArray(defaultsRes.data.barcodeBandsJson)
                        ? defaultsRes.data.barcodeBandsJson
                        : [],
                    cashDenominationsJson: Array.isArray(defaultsRes.data.cashDenominationsJson) && defaultsRes.data.cashDenominationsJson.length
                        ? defaultsRes.data.cashDenominationsJson
                        : DEFAULT_CASH_DENOMS,
                    posEstimateShowDiscountsJson: normalizeEstimateDiscountVisibility(defaultsRes.data.posEstimateShowDiscountsJson),
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

    // ── Cash denomination editor helpers ──────────────────────────────────────
    const denoms = draft?.cashDenominationsJson ?? [];
    const [newDenom, setNewDenom] = useState("");
    const addDenom = () => {
        const v = Number(digitsOnly(newDenom));
        if (!v || denoms.includes(v)) { setNewDenom(""); return; }
        setDraft((d) => d && { ...d, cashDenominationsJson: [...(d.cashDenominationsJson ?? []), v].sort((a, b) => b - a) });
        setNewDenom("");
    };
    const removeDenom = (val: number) =>
        setDraft((d) => d && { ...d, cashDenominationsJson: (d.cashDenominationsJson ?? []).filter((x) => x !== val) });
    const resetDenoms = () =>
        setDraft((d) => d && { ...d, cashDenominationsJson: [...DEFAULT_CASH_DENOMS] });

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
                // Server dedupes + sorts high → low; send as-is.
                cashDenominationsJson: draft.cashDenominationsJson ?? [],
                shippingPoolGroupId: draft.shippingPoolGroupId,
                posEstimateShowDiscountsJson: draft.posEstimateShowDiscountsJson ?? DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY,
            };
            const { data: saved } = await axios.patch<OrgDefaults>("/api/settings/org-defaults", payload);
            setData(saved);
            setDraft(saved);
            invalidateOrgDefaultsCache();
            toast.success("Org defaults saved");
        } catch (err) {
            toast.error(extractApiError(err, "Failed to save"));
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

            {/* Additional-cost (shipping/courier) pool group */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Additional-cost pool group</h2>
                    <p className="text-xs text-muted-foreground">
                        The account group whose posted debits feed the pricing
                        <span className="font-medium"> Costing</span> page&apos;s &ldquo;waiting&rdquo; pool. Create a
                        ledger per courier / counter under this group, then allocate each posted
                        payment to products as a per-unit shipping cost (used for pricing &amp; margin
                        only — it never posts to the books).
                    </p>
                </div>

                <div className="max-w-[320px] space-y-1">
                    <Label className="text-xs">Pool group</Label>
                    <Select
                        value={draft.shippingPoolGroupId != null ? String(draft.shippingPoolGroupId) : NONE}
                        onValueChange={(v) => set("shippingPoolGroupId", v === NONE ? null : Number(v))}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue placeholder="None — feature off" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NONE}>None — feature off</SelectItem>
                            {accountGroups.map((g) => (
                                <SelectItem key={g.id} value={String(g.id)}>
                                    {g.name} <span className="text-muted-foreground">· {g.type}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">Typically an Expense group (e.g. &ldquo;Courier &amp; Shipping Cost Pool&rdquo;).</p>
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

            {/* Cash denominations (POS shift-close counter) */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">Cash denominations</h2>
                    <p className="text-xs text-muted-foreground">
                        Note &amp; coin values shown in the <span className="font-medium">POS shift-close</span> counter,
                        high → low. Remove the ones your currency doesn&apos;t use, or add new ones.
                    </p>
                </div>

                <div className="space-y-3">
                    {denoms.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground">
                            No denominations — the close counter falls back to manual entry. Add one or reset to defaults.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {denoms.map((v) => (
                                <span key={v} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-sm">
                                    {draft.defaultCurrencySymbol}{v.toLocaleString("en-IN")}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${v}`}
                                        onClick={() => removeDenom(v)}
                                        className="text-muted-foreground transition-colors hover:text-destructive"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Input
                            inputMode="numeric"
                            className="h-8 w-40 font-mono text-sm"
                            placeholder="Add denomination"
                            value={newDenom}
                            onChange={(e) => setNewDenom(digitsOnly(e.target.value))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDenom(); } }}
                        />
                        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addDenom}>
                            <Plus className="size-4" /> Add
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-muted-foreground" onClick={resetDenoms}>
                            Reset to defaults
                        </Button>
                    </div>
                </div>
            </section>

            {/* POS Estimate print — discount visibility */}
            <section className="rounded-lg border bg-card p-4 space-y-4">
                <div>
                    <h2 className="text-sm font-semibold">POS Estimate print — show discounts</h2>
                    <p className="text-xs text-muted-foreground">
                        On a <span className="font-medium">POS Estimate</span>, the cashier&apos;s screen always shows
                        discounts (to negotiate). The <span className="font-medium">customer copy</span> (print + display)
                        hides them by default so the customer sees only the tag / list price. Turn a row on to reveal that
                        discount on the customer copy too.
                    </p>
                </div>
                <div className="space-y-2">
                    {(Object.keys(ESTIMATE_DISCOUNT_LABELS) as (keyof EstimateDiscountVisibility)[]).map((k) => (
                        <div key={k} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                            <Label htmlFor={`est-disc-${k}`} className="font-normal">{ESTIMATE_DISCOUNT_LABELS[k]}</Label>
                            <Switch
                                id={`est-disc-${k}`}
                                checked={draft.posEstimateShowDiscountsJson?.[k] ?? false}
                                disabled={saving}
                                onCheckedChange={(v) =>
                                    setDraft((d) => d && {
                                        ...d,
                                        posEstimateShowDiscountsJson: {
                                            ...(d.posEstimateShowDiscountsJson ?? DEFAULT_ESTIMATE_DISCOUNT_VISIBILITY),
                                            [k]: v,
                                        },
                                    })
                                }
                            />
                        </div>
                    ))}
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
