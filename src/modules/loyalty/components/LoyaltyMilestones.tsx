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

interface Milestone {
    id: number;
    threshold: string | number;
    bonusPoints: number;
    label: string | null;
    enabled: boolean;
    _count?: { awards: number };
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const int = (s: string): string => s.replace(/\D/g, "");
const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function LoyaltyMilestones() {
    const [tiers, setTiers] = useState<Milestone[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [threshold, setThreshold] = useState("");
    const [bonus, setBonus] = useState("");
    const [label, setLabel] = useState("");
    const [adding, setAdding] = useState(false);

    function load() {
        axios
            .get<Milestone[]>("/api/loyalty/milestones")
            .then((r) => setTiers(r.data))
            .catch(() => toast.error("Failed to load milestones"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function add() {
        const t = Number(threshold);
        const b = Number(bonus);
        if (!(t > 0) || !(b > 0)) return toast.error("Enter a spend threshold and bonus points");
        setAdding(true);
        try {
            await axios.post("/api/loyalty/milestones", {
                threshold: t,
                bonusPoints: b,
                label: label.trim() || null,
            });
            toast.success("Milestone added");
            setThreshold(""); setBonus(""); setLabel(""); setShowAdd(false);
            load();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to add milestone") : "Failed to add milestone";
            toast.error(msg);
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
                                <Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(dec(e.target.value))} placeholder="50000" className="h-9 pl-6 text-right" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Bonus points</Label>
                            <Input inputMode="numeric" value={bonus} onChange={(e) => setBonus(int(e.target.value))} placeholder="500" className="h-9 text-right" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Label (optional)</Label>
                            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gold reward" className="h-9" />
                        </div>
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
                                    {fmtINR(Number(t.threshold))} <span className="text-muted-foreground">→</span> +{t.bonusPoints.toLocaleString("en-IN")} pts
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
