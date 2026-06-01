"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface LoyaltyConfig {
    id: number;
    enabled: boolean;
    globalEarnRatePer: string | number;
    redeemValue: string | number;
    expiryEnabled: boolean;
    expiryDays: number;
    minEarnInvoiceValue: string | number | null;
    minRedeemInvoiceValue: string | number | null;
    minRedeemPoints: number | null;
    maxRedeemPctOfBill: string | number | null;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const int = (s: string): string => s.replace(/\D/g, "");

// Optional ₹/int field: "" ⇄ null.
function optNum(v: string | number | null): string {
    return v == null ? "" : String(v);
}

export function LoyaltyConfigForm() {
    const [draft, setDraft] = useState<LoyaltyConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios
            .get<LoyaltyConfig>("/api/loyalty/config")
            .then((r) => setDraft(r.data))
            .catch(() => toast.error("Failed to load loyalty config"))
            .finally(() => setLoading(false));
    }, []);

    function set<K extends keyof LoyaltyConfig>(key: K, value: LoyaltyConfig[K]) {
        setDraft((d) => d && { ...d, [key]: value });
    }

    async function save() {
        if (!draft) return;
        setSaving(true);
        try {
            const nullableNum = (v: string | number | null) => (v == null || v === "" ? null : Number(v));
            const payload = {
                enabled:               draft.enabled,
                globalEarnRatePer:     Number(draft.globalEarnRatePer) || 0,
                redeemValue:           Number(draft.redeemValue) || 0,
                expiryEnabled:         draft.expiryEnabled,
                expiryDays:            Number(draft.expiryDays) || 1,
                minEarnInvoiceValue:   nullableNum(draft.minEarnInvoiceValue),
                minRedeemInvoiceValue: nullableNum(draft.minRedeemInvoiceValue),
                minRedeemPoints:       draft.minRedeemPoints == null ? null : Number(draft.minRedeemPoints),
                maxRedeemPctOfBill:    nullableNum(draft.maxRedeemPctOfBill),
            };
            const { data } = await axios.patch<LoyaltyConfig>("/api/loyalty/config", payload);
            setDraft(data);
            toast.success("Loyalty settings saved");
        } catch {
            toast.error("Failed to save loyalty settings");
        } finally {
            setSaving(false);
        }
    }

    if (loading || !draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

    return (
        <div className="max-w-xl space-y-6 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-sm font-medium">Loyalty programme</Label>
                    <p className="text-xs text-muted-foreground">When off, no points are earned or redeemable at POS.</p>
                </div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            {/* ── Reward Setup (earn) ─────────────────────────────────────── */}
            <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">Reward Setup</h3>
                <div className="space-y-1">
                    <Label htmlFor="earn" className="text-xs text-muted-foreground">Loyalty point conversion — ₹ per 1 point</Label>
                    <Input id="earn" inputMode="decimal" value={String(draft.globalEarnRatePer)} onChange={(e) => set("globalEarnRatePer", dec(e.target.value))} />
                    <p className="text-[11px] text-muted-foreground">Award 1 point for every ₹{String(draft.globalEarnRatePer || 0)} of net goods (per category/group/product multipliers below).</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="minearn" className="text-xs text-muted-foreground">Minimum invoice value to earn (optional)</Label>
                    <Input id="minearn" inputMode="decimal" value={optNum(draft.minEarnInvoiceValue)} onChange={(e) => set("minEarnInvoiceValue", dec(e.target.value) || null)} placeholder="no minimum" />
                    <p className="text-[11px] text-muted-foreground">Sales below this value earn no points.</p>
                </div>
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Set point expiry</Label>
                    <Switch checked={draft.expiryEnabled} onCheckedChange={(v) => set("expiryEnabled", v)} />
                </div>
                {draft.expiryEnabled && (
                    <div className="space-y-1">
                        <Label htmlFor="expdays" className="text-xs text-muted-foreground">Points expire after — days</Label>
                        <Input id="expdays" inputMode="numeric" value={String(draft.expiryDays)} onChange={(e) => set("expiryDays", Number(int(e.target.value) || "0"))} />
                        <p className="text-[11px] text-muted-foreground">Validity is dynamic: raising this revives recently-lapsed points; lowering it drops older ones.</p>
                    </div>
                )}
            </div>

            {/* ── Redeem Setup ────────────────────────────────────────────── */}
            <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">Redeem Setup</h3>
                <div className="space-y-1">
                    <Label htmlFor="redeem" className="text-xs text-muted-foreground">Redemption value — ₹ per 1 point</Label>
                    <Input id="redeem" inputMode="decimal" value={String(draft.redeemValue)} onChange={(e) => set("redeemValue", dec(e.target.value))} />
                    <p className="text-[11px] text-muted-foreground">Each point gives the customer ₹{String(draft.redeemValue || 0)} discount.</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="maxpct" className="text-xs text-muted-foreground">Maximum % of invoice value (optional)</Label>
                    <Input id="maxpct" inputMode="decimal" value={optNum(draft.maxRedeemPctOfBill)} onChange={(e) => set("maxRedeemPctOfBill", dec(e.target.value) || null)} placeholder="no cap" />
                    <p className="text-[11px] text-muted-foreground">Caps the loyalty discount at this % of the bill.</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="minredeeminv" className="text-xs text-muted-foreground">Minimum invoice value to redeem (optional)</Label>
                    <Input id="minredeeminv" inputMode="decimal" value={optNum(draft.minRedeemInvoiceValue)} onChange={(e) => set("minRedeemInvoiceValue", dec(e.target.value) || null)} placeholder="no minimum" />
                    <p className="text-[11px] text-muted-foreground">Invoices below this value can't redeem points.</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="minredeempts" className="text-xs text-muted-foreground">Minimum points to redeem (optional)</Label>
                    <Input id="minredeempts" inputMode="numeric" value={draft.minRedeemPoints == null ? "" : String(draft.minRedeemPoints)} onChange={(e) => { const v = int(e.target.value); set("minRedeemPoints", v === "" ? null : Number(v)); }} placeholder="none" />
                </div>
            </div>

            <div className="flex justify-end border-t border-border pt-4">
                <Button onClick={save} disabled={saving} size="sm">
                    <Save size={14} className="mr-1" /> {saving ? "Saving…" : "Save settings"}
                </Button>
            </div>
        </div>
    );
}
