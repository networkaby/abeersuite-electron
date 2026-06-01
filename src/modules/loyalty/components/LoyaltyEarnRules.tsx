"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Opt = { id: number; name: string; sku?: string };
type Scope = "CATEGORY" | "GROUP" | "PRODUCT";

interface EarnRule {
    id: number;
    scope: Scope;
    categoryId: number | null;
    groupId: number | null;
    productId: number | null;
    multiplier: string | number;
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
    const [scope, setScope] = useState<Scope>("CATEGORY");
    const [targetId, setTargetId] = useState<string>("");
    const [multiplier, setMultiplier] = useState("1");
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
                groupId:    scope === "GROUP" ? id : null,
                productId:  scope === "PRODUCT" ? id : null,
                multiplier: Number(multiplier) || 0,
            };
            await axios.post("/api/loyalty/earn-rules", body);
            toast.success("Earn rule added");
            setTargetId("");
            setMultiplier("1");
            load();
        } catch (e) {
            const msg = axios.isAxiosError(e) ? (e.response?.data?.error ?? "Failed to add rule") : "Failed to add rule";
            toast.error(msg);
        } finally {
            setAdding(false);
        }
    }

    async function patchRule(id: number, patch: { multiplier?: number; enabled?: boolean }) {
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

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400"><Layers size={15} /></span>
                    Earn-rate overrides
                </CardTitle>
                <CardDescription>
                    A multiplier on the global rate, resolved per line: product → group → category → global (1×).
                    Set loss-making items to <span className="font-medium">0×</span> so they earn nothing.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">

            {/* Add row */}
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
                <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Scope</Label>
                    <Select value={scope} onValueChange={(v) => { setScope(v as Scope); setTargetId(""); }}>
                        <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
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
                        <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                            {targetOptions.map((o) => (
                                <SelectItem key={o.id} value={String(o.id)}>{o.sku ? `${o.sku} — ${o.name}` : o.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Multiplier (×)</Label>
                    <Input value={multiplier} onChange={(e) => setMultiplier(dec(e.target.value))} className="h-8 w-24 text-right text-xs" />
                </div>
                <Button size="sm" onClick={add} disabled={adding}><Plus size={14} className="mr-1" /> Add</Button>
            </div>

            {/* List */}
            {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rules.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                    No overrides yet — everything earns at the global rate.
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-24">Scope</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead className="w-28 text-right">Multiplier</TableHead>
                            <TableHead className="w-20 text-center">Enabled</TableHead>
                            <TableHead className="w-12" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rules.map((r) => (
                            <TableRow key={r.id}>
                                <TableCell><Badge variant="secondary" className="text-[10px]">{r.scope}</Badge></TableCell>
                                <TableCell className="text-sm">{targetLabel(r)}</TableCell>
                                <TableCell className="text-right">
                                    <Input
                                        defaultValue={String(Number(r.multiplier))}
                                        onBlur={(e) => {
                                            const v = Number(dec(e.target.value));
                                            if (Number.isFinite(v) && v !== Number(r.multiplier)) patchRule(r.id, { multiplier: v });
                                        }}
                                        className="h-7 w-20 text-right text-xs ml-auto"
                                    />
                                </TableCell>
                                <TableCell className="text-center">
                                    <Switch checked={r.enabled} onCheckedChange={(v) => patchRule(r.id, { enabled: v })} />
                                </TableCell>
                                <TableCell>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(r.id)}>
                                        <Trash2 size={14} className="text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            </CardContent>
        </Card>
    );
}
