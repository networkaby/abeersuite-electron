"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Save, Coins, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface LoyaltyConfig {
    id: number;
    enabled: boolean;
    earnEnabled: boolean;
    redeemEnabled: boolean;
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
const optNum = (v: string | number | null): string => (v == null ? "" : String(v));

/// Small field wrapper — label, control, optional helper text.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
    );
}

/// ₹-prefixed text input.
function RupeeInput({ value, onChange, placeholder, className = "w-32" }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
    return (
        <div className={`relative ${className}`}>
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
            <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-6 text-right" />
        </div>
    );
}

/// Points-per-₹1 (what the user types) ↔ ₹-per-point (what we store).
const ptsToRedeemValue = (pts: number): number => (pts > 0 ? Number((1 / pts).toFixed(2)) : 0);
const redeemValueToPts = (rv: string | number): string => {
    const v = Number(rv);
    return v > 0 ? String(Number((1 / v).toFixed(2))) : "";
};

export function LoyaltyConfigForm() {
    const [draft, setDraft] = useState<LoyaltyConfig | null>(null);
    const [redeemPtsStr, setRedeemPtsStr] = useState(""); // points needed for ₹1 off (reciprocal of redeemValue)
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        axios
            .get<LoyaltyConfig>("/api/loyalty/config")
            .then((r) => {
                setDraft(r.data);
                setRedeemPtsStr(redeemValueToPts(r.data.redeemValue));
            })
            .catch(() => toast.error("Failed to load loyalty config"))
            .finally(() => setLoading(false));
    }, []);

    function set<K extends keyof LoyaltyConfig>(key: K, value: LoyaltyConfig[K]) {
        setDraft((d) => d && { ...d, [key]: value });
    }

    function onRedeemPtsChange(raw: string) {
        const s = dec(raw);
        setRedeemPtsStr(s);
        set("redeemValue", ptsToRedeemValue(Number(s)));
    }

    async function save() {
        if (!draft) return;
        setSaving(true);
        try {
            const nn = (v: string | number | null) => (v == null || v === "" ? null : Number(v));
            const { data } = await axios.patch<LoyaltyConfig>("/api/loyalty/config", {
                enabled:               draft.enabled,
                earnEnabled:           draft.earnEnabled,
                redeemEnabled:         draft.redeemEnabled,
                globalEarnRatePer:     Number(draft.globalEarnRatePer) || 0,
                redeemValue:           Number(draft.redeemValue) || 0,
                expiryEnabled:         draft.expiryEnabled,
                expiryDays:            Number(draft.expiryDays) || 1,
                minEarnInvoiceValue:   nn(draft.minEarnInvoiceValue),
                minRedeemInvoiceValue: nn(draft.minRedeemInvoiceValue),
                minRedeemPoints:       draft.minRedeemPoints == null ? null : Number(draft.minRedeemPoints),
                maxRedeemPctOfBill:    nn(draft.maxRedeemPctOfBill),
            });
            setDraft(data);
            setRedeemPtsStr(redeemValueToPts(data.redeemValue));
            toast.success("Loyalty settings saved");
        } catch {
            toast.error("Failed to save loyalty settings");
        } finally {
            setSaving(false);
        }
    }

    if (loading || !draft) {
        return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/30" />;
    }

    return (
        <div className="space-y-4">
            {/* Programme master toggle */}
            <Card>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                        <p className="text-sm font-medium">Loyalty program</p>
                        <p className="text-xs text-muted-foreground">When off, no points are earned or redeemable at POS.</p>
                    </div>
                    <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
                </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                {/* ── Reward Setup ────────────────────────────────────────── */}
                <Card className={draft.enabled && draft.earnEnabled ? "" : "opacity-60"}>
                    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div className="space-y-1.5">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"><Coins size={15} /></span>
                                Reward Setup
                            </CardTitle>
                            <CardDescription>How customers earn points.</CardDescription>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground">{draft.earnEnabled ? "Earning on" : "Earning off"}</span>
                            <Switch checked={draft.earnEnabled} disabled={!draft.enabled} onCheckedChange={(v) => set("earnEnabled", v)} />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Field label="Loyalty point conversion" hint="Per category/group/product multipliers can override this rate.">
                            <div className="flex items-center gap-2">
                                <RupeeInput value={String(draft.globalEarnRatePer)} onChange={(v) => set("globalEarnRatePer", dec(v))} />
                                <span className="text-sm text-muted-foreground">= 1 point</span>
                            </div>
                        </Field>
                        <Field label="Minimum invoice value to earn" hint="Sales below this earn no points. Blank = no minimum.">
                            <RupeeInput value={optNum(draft.minEarnInvoiceValue)} onChange={(v) => set("minEarnInvoiceValue", dec(v) || null)} placeholder="0.00" />
                        </Field>
                        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                            <span className="text-xs font-medium text-muted-foreground">Set point expiry</span>
                            <Switch checked={draft.expiryEnabled} onCheckedChange={(v) => set("expiryEnabled", v)} />
                        </div>
                        {draft.expiryEnabled && (
                            <Field label="Points expire after" hint="Dynamic: raising this revives recently-lapsed points; lowering it drops older ones.">
                                <div className="flex items-center gap-2">
                                    <Input inputMode="numeric" value={String(draft.expiryDays)} onChange={(e) => set("expiryDays", Number(int(e.target.value) || "0"))} className="w-28 text-right" />
                                    <span className="text-sm text-muted-foreground">days</span>
                                </div>
                            </Field>
                        )}
                    </CardContent>
                </Card>

                {/* ── Redeem Setup ────────────────────────────────────────── */}
                <Card className={draft.enabled && draft.redeemEnabled ? "" : "opacity-60"}>
                    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                        <div className="space-y-1.5">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"><Ticket size={15} /></span>
                                Redeem Setup
                            </CardTitle>
                            <CardDescription>How points convert to a discount.</CardDescription>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground">{draft.redeemEnabled ? "Redeeming on" : "Redeeming off"}</span>
                            <Switch checked={draft.redeemEnabled} disabled={!draft.enabled} onCheckedChange={(v) => set("redeemEnabled", v)} />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Field label="Redemption value" hint="Points a customer spends for ₹1 off the bill.">
                            <div className="flex items-center gap-2">
                                <Input inputMode="decimal" value={redeemPtsStr} onChange={(e) => onRedeemPtsChange(e.target.value)} className="w-28 text-right" />
                                <span className="text-sm text-muted-foreground">points = ₹1</span>
                            </div>
                        </Field>
                        <Field label="Maximum % of invoice value" hint="Caps the loyalty discount at this share of the bill. Blank = no cap.">
                            <div className="flex items-center gap-2">
                                <Input inputMode="decimal" value={optNum(draft.maxRedeemPctOfBill)} onChange={(e) => set("maxRedeemPctOfBill", dec(e.target.value) || null)} placeholder="0" className="w-24 text-right" />
                                <span className="text-sm text-muted-foreground">%</span>
                            </div>
                        </Field>
                        <Field label="Minimum invoice value to redeem" hint="Invoices below this can't redeem points. Blank = no minimum.">
                            <RupeeInput value={optNum(draft.minRedeemInvoiceValue)} onChange={(v) => set("minRedeemInvoiceValue", dec(v) || null)} placeholder="0.00" />
                        </Field>
                        <Field label="Minimum points to redeem" hint="Blank = none.">
                            <Input inputMode="numeric" value={draft.minRedeemPoints == null ? "" : String(draft.minRedeemPoints)} onChange={(e) => { const v = int(e.target.value); set("minRedeemPoints", v === "" ? null : Number(v)); }} placeholder="0" className="w-28 text-right" />
                        </Field>
                    </CardContent>
                </Card>
            </div>

            <div className="flex justify-end">
                <Button onClick={save} disabled={saving} size="sm">
                    <Save size={14} className="mr-1.5" /> {saving ? "Saving…" : "Save settings"}
                </Button>
            </div>
        </div>
    );
}
