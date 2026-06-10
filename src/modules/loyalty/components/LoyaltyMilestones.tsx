"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Trophy, X, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractApiError } from "@/shared/lib/api";
import { parseDecimalInput, parseDigitsInput, formatInr } from "@/shared/lib/format";

interface Milestone {
    id: number;
    threshold: string | number;
    bonusPoints: number;
    label: string | null;
    enabled: boolean;
    issuesCouponTemplateId: number | null;
    _count?: { awards: number };
}

interface CouponOpt { id: number; name: string; code: string | null }

export function LoyaltyMilestones() {
    const [tiers, setTiers] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [threshold, setThreshold] = useState("");
    const [bonus, setBonus] = useState("");
    const [label, setLabel] = useState("");
    const [couponTemplateId, setCouponTemplateId] = useState<string>("none");
    const [coupons, setCoupons] = useState<CouponOpt[]>([]);
    const [adding, setAdding] = useState(false);

    function load() {
        axios
            .get<Milestone[]>("/api/loyalty/milestones")
            .then((r) => setTiers(r.data))
            .catch(() => toast.error("Failed to load milestones"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);
    useEffect(() => {
        axios.get<CouponOpt[]>("/api/coupons").then((r) => setCoupons(r.data)).catch(() => { /* optional */ });
    }, []);

    async function add() {
        const t = Number(threshold);
        const b = Number(bonus || "0");
        const couponId = couponTemplateId === "none" ? null : Number(couponTemplateId);
        if (!(t > 0)) return toast.error("Enter a spend threshold");
        if (!(b > 0) && couponId == null) return toast.error("Set bonus points and/or a coupon to issue");
        setAdding(true);
        try {
            await axios.post("/api/loyalty/milestones", {
                threshold: t,
                bonusPoints: b,
                label: label.trim() || null,
                issuesCouponTemplateId: couponId,
            });
            toast.success("Milestone added");
            setThreshold(""); setBonus(""); setLabel(""); setCouponTemplateId("none"); setShowAdd(false);
            load();
        } catch (e) {
            toast.error(extractApiError(e, "Failed to add milestone"));
        } finally {
            setAdding(false);
        }
    }

    async function patchTier(id: number, patch: Partial<Pick<Milestone, "enabled">> & { bonusPoints?: number; threshold?: number; label?: string | null }) {
        try {
            await axios.patch(`/api/loyalty/milestones/${id}`, patch);
            load();
        } catch {
            toast.error("Failed to update milestone");
        }
    }

    async function remove(id: number) {
        try {
            await axios.delete(`/api/loyalty/milestones/${id}`);
            setTiers((ts) => ts.filter((t) => t.id !== id));
        } catch {
            toast.error("Failed to delete milestone");
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"><Trophy size={15} /></span>
                        Milestone rewards
                    </CardTitle>
                    <CardDescription>
                        One-time bonus points when a customer&rsquo;s <span className="font-medium">lifetime spend</span> crosses a tier.
                        Awarded automatically at checkout.
                    </CardDescription>
                </div>
                {!showAdd && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAdd(true)}>
                        <Plus size={14} className="mr-1" /> Add
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">

            {showAdd && (
                <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">New milestone</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}><X size={14} /></Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Lifetime spend ≥</Label>
                            <div className="relative">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                <Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(parseDecimalInput(e.target.value))} placeholder="50000" className="h-9 pl-6 text-right" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Bonus points</Label>
                            <Input inputMode="numeric" value={bonus} onChange={(e) => setBonus(parseDigitsInput(e.target.value))} placeholder="500" className="h-9 text-right" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Label (optional)</Label>
                            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gold reward" className="h-9" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Also issue a coupon (optional)</Label>
                        <Select value={couponTemplateId} onValueChange={setCouponTemplateId}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="— no coupon —" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">— no coupon —</SelectItem>
                                {coupons.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>{c.code ? `${c.code} · ` : ""}{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">Crossing the tier auto-issues a unique single-use copy of this coupon to the customer. Set bonus points to 0 for a coupon-only milestone.</p>
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={add} disabled={adding}><Plus size={14} className="mr-1" /> Add milestone</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tiers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                    No milestones yet — add a tier to reward big-spending customers with bonus points.
                </div>
            ) : (
                <ul className="divide-y rounded-lg border border-border/60">
                    {tiers.map((t) => (
                        <li key={t.id} className={`flex items-center gap-3 px-3 py-2.5 ${t.enabled ? "" : "opacity-50"}`}>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"><Gift size={15} /></span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                    {formatInr(Number(t.threshold), 0)} <span className="text-muted-foreground">→</span>{" "}
                                    {t.bonusPoints > 0 ? `+${t.bonusPoints.toLocaleString("en-IN")} pts` : ""}
                                    {t.bonusPoints > 0 && t.issuesCouponTemplateId != null ? " + " : ""}
                                    {t.issuesCouponTemplateId != null ? "🎟 coupon" : ""}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                    {t.label ? `${t.label} · ` : ""}{t._count?.awards ?? 0} awarded
                                </div>
                            </div>
                            <Switch className="shrink-0" checked={t.enabled} onCheckedChange={(v) => patchTier(t.id, { enabled: v })} />
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => remove(t.id)}>
                                <Trash2 size={14} className="text-destructive" />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            </CardContent>
        </Card>
    );
}
