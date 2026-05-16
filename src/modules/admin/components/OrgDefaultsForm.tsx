"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { invalidateOrgDefaultsCache } from "@/shared/lib/orgDefaults";
import { Save } from "lucide-react";
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

interface OrgDefaults {
    id: number;
    defaultUnitId: number | null;
    defaultGstRateId: number | null;
    defaultHsnCode: string | null;
    defaultTaxability: string | null;
    defaultSaleCreditPeriod: number | null;
    defaultPurchaseCreditPeriod: number | null;
    defaultCurrencySymbol: string;
}

const TAXABILITY_OPTIONS = [
    { value: "TAXABLE", label: "Taxable" },
    { value: "EXEMPT", label: "Exempt" },
    { value: "NIL_RATED", label: "Nil Rated (0%)" },
    { value: "NON_GST", label: "Non-GST" },
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
                setData(defaultsRes.data);
                setDraft(defaultsRes.data);
                setGstRates(ratesRes.data);
            })
            .catch(() => toast.error("Failed to load org defaults"))
            .finally(() => setLoading(false));
    }, []);

    function set<K extends keyof OrgDefaults>(key: K, value: OrgDefaults[K]) {
        setDraft((d) => d && { ...d, [key]: value });
    }

    async function handleSave() {
        if (!draft) return;
        setSaving(true);
        try {
            const payload = {
                defaultUnitId: draft.defaultUnitId,
                defaultGstRateId: draft.defaultGstRateId,
                defaultHsnCode: draft.defaultHsnCode,
                defaultTaxability: draft.defaultTaxability,
                defaultSaleCreditPeriod: draft.defaultSaleCreditPeriod,
                defaultPurchaseCreditPeriod: draft.defaultPurchaseCreditPeriod,
                defaultCurrencySymbol: draft.defaultCurrencySymbol,
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

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                    <Save className="mr-1.5 size-3.5" />
                    {saving ? "Saving…" : "Save defaults"}
                </Button>
            </div>
        </div>
    );
}
