"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { id: number; name: string; sku?: string };
type Scope = "CATEGORY" | "GROUP" | "PRODUCT";

interface EarnRule {
    id: number;
    scope: Scope;
    categoryId: number | null;
    groupId: number | null;
    productId: number | null;
    multiplier: string | number;
    redeemCapPct: string | number | null;
    enabled: boolean;
    category: { id: number; name: string } | null;
    group: { id: number; name: string } | null;
    product: { id: number; name: string; sku: string } | null;
}

const dec = (s: string): string => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

export function LoyaltyEarnRules({
    categories,
    groups,
    products,
}: {
    categories: Opt[];
    groups: Opt[];
    products: Opt[];
}) {
    const [rules, setRules] = useState<EarnRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [scope, setScope] = useState<Scope>("CATEGORY");
    const [targetId, setTargetId] = useState<string>("");
    const [multiplier, setMultiplier] = useState("1");
    const [redeemCap, setRedeemCap] = useState(""); // blank = inherit global cap
    const [adding, setAdding] = useState(false);

    function load() {
        axios
            .get<EarnRule[]>("/api/loyalty/earn-rules")
            .then((r) => setRules(r.data))
            .catch(() => toast.error("Failed to load earn rules"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    const targetOptions = scope === "CATEGORY" ? categories : scope === "GROUP" ? groups : products;

    async function add() {
        if (!targetId) return toast.error("Pick a target");
        setAdding(true);
        try {
            const id = Number(targetId);
            const body = {
                scope,
                categoryId: scope === "CATEGORY" ? id : null,
                groupId: scope === "GROUP" ? id : null,
                productId: scope === "PRODUCT" ? id : null,
                multiplier: Number(multiplier) || 0,
                redeemCapPct: redeemCap.trim() === "" ? null : Number(redeemCap),
            };
            await axios.post("/api/loyalty/earn-rules", body);
            toast.success("Rule added");
            setTargetId("");
            setMultiplier("1");
            setRedeemCap("");
            setShowAdd(false);
            load();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to add rule") : "Failed to add rule";
            toast.error(msg);
        } finally {
            setAdding(false);
        }
    }

    async function patchRule(id: number, patch: { multiplier?: number; enabled?: boolean; redeemCapPct?: number | null }) {
        try {
            await axios.patch(`/api/loyalty/earn-rules/${id}`, patch);
            load();
        } catch {
            toast.error("Failed to update rule");
        }
    }

    async function remove(id: number) {
        try {
            await axios.delete(`/api/loyalty/earn-rules/${id}`);
            setRules((rs) => rs.filter((r) => r.id !== id));
        } catch {
            toast.error("Failed to delete rule");
        }
    }

    function targetLabel(r: EarnRule): string {
        if (r.scope === "CATEGORY") return r.category?.name ?? `Category #${r.categoryId}`;
        if (r.scope === "GROUP") return r.group?.name ?? `Group #${r.groupId}`;
        return r.product ? `${r.product.sku} — ${r.product.name}` : `Product #${r.productId}`;
    }

    const scopeStyle: Record<Scope, string> = {
        CATEGORY: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
        GROUP: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
        PRODUCT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400"><Layers size={15} /></span>
                        Item-wise rates
                    </CardTitle>
                    <CardDescription>
                        Per item (product → group → category → global): an <span className="font-medium">earn ×</span>
                        and a <span className="font-medium">redeem cap %</span> (max of the item payable with points).
                        0× = earns nothing; 0% = points can&rsquo;t be spent on it; blank cap = global default.
                    </CardDescription>
                </div>
                {!showAdd && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAdd(true)}>
                        <Plus size={14} className="mr-1" /> Add
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">

                {/* Add form (collapsible) */}
                {showAdd && (
                    <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">New override</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}>
                                <X size={14} />
                            </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Scope</Label>
                                <Select value={scope} onValueChange={(v) => { setScope(v as Scope); setTargetId(""); }}>
                                    <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CATEGORY">Category</SelectItem>
                                        <SelectItem value="GROUP">Group</SelectItem>
                                        <SelectItem value="PRODUCT">Product</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Target</Label>
                                <Select value={targetId} onValueChange={setTargetId}>
                                    <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
                                    <SelectContent>
                                        {targetOptions.map((o) => (
                                            <SelectItem key={o.id} value={String(o.id)}>{o.sku ? `${o.sku} — ${o.name}` : o.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-muted-foreground">Earn multiplier</Label>
                                    <div className="flex items-center gap-1.5">
                                        <Input value={multiplier} onChange={(e) => setMultiplier(dec(e.target.value))} className="h-9 w-20 text-right" />
                                        <span className="text-sm text-muted-foreground">× global</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[11px] text-muted-foreground">Redeem cap</Label>
                                    <div className="flex items-center gap-1.5">
                                        <Input value={redeemCap} onChange={(e) => setRedeemCap(dec(e.target.value))} placeholder="global" className="h-9 w-20 text-right" />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                            </div>
                            <Button size="sm" onClick={add} disabled={adding}><Plus size={14} className="mr-1" /> Add rule</Button>
                        </div>
                    </div>
                )}

                {/* List */}
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : rules.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                        No overrides yet — everything earns at the global rate.
                    </div>
                ) : (
                    <ul className="divide-y rounded-lg border border-border/60">
                        {rules.map((r) => (
                            <li key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${r.enabled ? "" : "opacity-50"}`}>
                                <Badge variant="secondary" className={`shrink-0 text-[10px] ${scopeStyle[r.scope]}`}>{r.scope}</Badge>
                                <span className="min-w-0 flex-1 truncate text-sm" title={targetLabel(r)}>{targetLabel(r)}</span>
                                <div className="flex shrink-0 items-center gap-1" title="Earn multiplier on the global rate">
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Earn Per Product x</span>
                                    <Input
                                        defaultValue={String(Number(r.multiplier))}
                                        onBlur={(e) => {
                                            const v = Number(dec(e.target.value));
                                            if (Number.isFinite(v) && v !== Number(r.multiplier)) patchRule(r.id, { multiplier: v });
                                        }}
                                        className="h-8 w-14 text-right text-xs"
                                    />
                                    {/* <span className="text-xs text-muted-foreground">×</span> */}
                                </div>
                                <div className="flex shrink-0 items-center gap-1" title="Redeem cap — max % of this item payable with points (blank = global)">
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Product Cap%</span>
                                    <Input
                                        defaultValue={r.redeemCapPct == null ? "" : String(Number(r.redeemCapPct))}
                                        placeholder="global"
                                        onBlur={(e) => {
                                            const raw = dec(e.target.value).trim();
                                            const next = raw === "" ? null : Number(raw);
                                            const cur = r.redeemCapPct == null ? null : Number(r.redeemCapPct);
                                            if (next !== cur) patchRule(r.id, { redeemCapPct: next });
                                        }}
                                        className="h-8 w-16 text-right text-xs"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                </div>
                                <Switch className="shrink-0" checked={r.enabled} onCheckedChange={(v) => patchRule(r.id, { enabled: v })} />
                                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => remove(r.id)}>
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
