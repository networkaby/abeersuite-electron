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
    expiryMonths: number;
    minRedeemPoints: number | null;
    maxRedeemPctOfBill: string | number | null;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const int = (s: string): string => s.replace(/\D/g, "");

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
            const payload = {
                enabled:            draft.enabled,
                globalEarnRatePer:  Number(draft.globalEarnRatePer) || 0,
                redeemValue:        Number(draft.redeemValue) || 0,
                expiryMonths:       Number(draft.expiryMonths) || 1,
                minRedeemPoints:    draft.minRedeemPoints == null ? null : Number(draft.minRedeemPoints),
                maxRedeemPctOfBill: draft.maxRedeemPctOfBill == null || draft.maxRedeemPctOfBill === "" ? null : Number(draft.maxRedeemPctOfBill),
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
        <div className="max-w-xl space-y-4 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-sm font-medium">Loyalty programme</Label>
                    <p className="text-xs text-muted-foreground">When off, no points are earned or redeemable at POS.</p>
                </div>
                <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <Label htmlFor="earn" className="text-xs text-muted-foreground">Earn rate — ₹ per 1 point</Label>
                    <Input id="earn" inputMode="decimal" value={String(draft.globalEarnRatePer)} onChange={(e) => set("globalEarnRatePer", dec(e.target.value))} />
                    <p className="text-[11px] text-muted-foreground">e.g. 100 → 1 pt per ₹100 of net goods.</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="redeem" className="text-xs text-muted-foreground">Redeem value — ₹ per 1 point</Label>
                    <Input id="redeem" inputMode="decimal" value={String(draft.redeemValue)} onChange={(e) => set("redeemValue", dec(e.target.value))} />
                    <p className="text-[11px] text-muted-foreground">e.g. 1 → 1 pt = ₹1 off.</p>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="expiry" className="text-xs text-muted-foreground">Points expiry — months</Label>
                    <Input id="expiry" inputMode="numeric" value={String(draft.expiryMonths)} onChange={(e) => set("expiryMonths", Number(int(e.target.value) || "0"))} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="minredeem" className="text-xs text-muted-foreground">Min points to redeem (optional)</Label>
                    <Input id="minredeem" inputMode="numeric" value={draft.minRedeemPoints == null ? "" : String(draft.minRedeemPoints)} onChange={(e) => { const v = int(e.target.value); set("minRedeemPoints", v === "" ? null : Number(v)); }} placeholder="none" />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="maxpct" className="text-xs text-muted-foreground">Max redemption — % of bill (optional)</Label>
                    <Input id="maxpct" inputMode="decimal" value={draft.maxRedeemPctOfBill == null ? "" : String(draft.maxRedeemPctOfBill)} onChange={(e) => { const v = dec(e.target.value); set("maxRedeemPctOfBill", v === "" ? null : v); }} placeholder="no cap" />
                </div>
            </div>

            <div className="flex justify-end">
                <Button onClick={save} disabled={saving} size="sm">
                    <Save size={14} className="mr-1" /> {saving ? "Saving…" : "Save settings"}
                </Button>
            </div>
        </div>
    );
}
