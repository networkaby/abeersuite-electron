"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Crown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface Tier {
    id: number;
    name: string;
    minSpend: string | number;
    discountPct: string | number;
    enabled: boolean;
    sortOrder: number;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

export function CustomerTiers() {
    const [tiers, setTiers] = useState<Tier[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [name, setName] = useState("");
    const [minSpend, setMinSpend] = useState("");
    const [discountPct, setDiscountPct] = useState("");
    const [adding, setAdding] = useState(false);

    function load() {
        axios
            .get<Tier[]>("/api/customer-tiers")
            .then((r) => setTiers(r.data))
            .catch(() => toast.error("Failed to load tiers"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function add() {
        if (!name.trim()) return toast.error("Name the tier");
        const ms = Number(minSpend), dp = Number(discountPct);
        if (!Number.isFinite(ms) || !Number.isFinite(dp)) return toast.error("Enter a spend threshold and discount %");
        setAdding(true);
        try {
            await axios.post("/api/customer-tiers", { name: name.trim(), minSpend: ms, discountPct: dp });
            toast.success("Tier added");
            setName(""); setMinSpend(""); setDiscountPct(""); setShowAdd(false);
            load();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to add tier") : "Failed to add tier";
            toast.error(msg);
        } finally {
            setAdding(false);
        }
    }

    async function patchTier(id: number, patch: Partial<Pick<Tier, "name" | "enabled">> & { minSpend?: number; discountPct?: number }) {
        try {
            await axios.patch(`/api/customer-tiers/${id}`, patch);
            load();
        } catch {
            toast.error("Failed to update tier");
        }
    }

    async function remove(id: number) {
        try {
            await axios.delete(`/api/customer-tiers/${id}`);
            setTiers((ts) => ts.filter((t) => t.id !== id));
        } catch {
            toast.error("Failed to delete tier");
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"><Crown size={15} /></span>
                        Spend tiers
                    </CardTitle>
                    <CardDescription>
                        Automatic discount by <span className="font-medium">lifetime spend</span> — applied on pre-GST goods at POS
                        (posts to &ldquo;Discount Allowed&rdquo;). The highest enabled tier a customer&rsquo;s spend reaches wins.
                    </CardDescription>
                </div>
                {!showAdd && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAdd(true)}>
                        <Plus size={14} className="mr-1" /> Add tier
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">

            {showAdd && (
                <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">New tier</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}><X size={14} /></Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Name</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold" className="h-9" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Lifetime spend ≥</Label>
                            <div className="relative">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                <Input inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(dec(e.target.value))} placeholder="50000" className="h-9 pl-6 text-right" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Discount %</Label>
                            <Input inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(dec(e.target.value))} placeholder="5" className="h-9 text-right" />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <Button size="sm" onClick={add} disabled={adding}><Plus size={14} className="mr-1" /> Add tier</Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : tiers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                    No tiers — add one to give big-spending customers an automatic discount.
                </div>
            ) : (
                <ul className="divide-y rounded-lg border border-border/60">
                    {tiers.map((t) => (
                        <li key={t.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${t.enabled ? "" : "opacity-50"}`}>
                            <Input
                                defaultValue={t.name}
                                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) patchTier(t.id, { name: v }); }}
                                className="h-8 w-28 text-sm font-medium"
                            />
                            <div className="flex flex-1 items-center gap-1.5" title="Lifetime spend to reach this tier">
                                <span className="text-xs text-muted-foreground">from</span>
                                <div className="relative w-32">
                                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                                    <Input
                                        defaultValue={String(Number(t.minSpend))}
                                        onBlur={(e) => { const v = Number(dec(e.target.value)); if (Number.isFinite(v) && v !== Number(t.minSpend)) patchTier(t.id, { minSpend: v }); }}
                                        className="h-8 pl-6 text-right text-xs"
                                    />
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1" title="Discount % at this tier">
                                <Input
                                    defaultValue={String(Number(t.discountPct))}
                                    onBlur={(e) => { const v = Number(dec(e.target.value)); if (Number.isFinite(v) && v !== Number(t.discountPct)) patchTier(t.id, { discountPct: v }); }}
                                    className="h-8 w-16 text-right text-xs"
                                />
                                <span className="text-xs text-muted-foreground">%</span>
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
