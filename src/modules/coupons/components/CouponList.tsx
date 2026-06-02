"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CouponForm, type Coupon, type CategoryOpt, type ProductOpt } from "./CouponForm";

const typeLabel: Record<Coupon["type"], string> = { PERCENT: "% off", FLAT: "Flat ₹", FREE_ITEM: "Free item", BOGO: "Buy X get Y" };
const channelTone: Record<Coupon["channels"], string> = {
    BOTH: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    POS:  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    SHOP: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

function valueSummary(c: Coupon): string {
    if (c.type === "PERCENT") return `${Number(c.percentOff ?? 0)}% off${c.maxDiscountAmt != null ? ` (max ₹${Number(c.maxDiscountAmt)})` : ""}`;
    if (c.type === "FLAT") return `₹${Number(c.flatAmt ?? 0)} off`;
    return typeLabel[c.type];
}

export function CouponList({ categories, products }: { categories: CategoryOpt[]; products: ProductOpt[] }) {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);

    function load() {
        axios.get<Coupon[]>("/api/coupons")
            .then((r) => setCoupons(r.data))
            .catch(() => toast.error("Failed to load coupons"))
            .finally(() => setLoading(false));
    }
    useEffect(load, []);

    async function patch(id: number, body: Partial<Coupon>) {
        try { await axios.patch(`/api/coupons/${id}`, body); load(); }
        catch { toast.error("Failed to update coupon"); }
    }
    async function remove(id: number) {
        try {
            const r = await axios.delete<{ softDisabled?: boolean }>(`/api/coupons/${id}`);
            toast.success(r.data.softDisabled ? "Coupon disabled (it has redemptions)" : "Coupon deleted");
            load();
        } catch { toast.error("Failed to delete coupon"); }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"><Ticket size={15} /></span>
                        Coupons
                    </CardTitle>
                    <CardDescription>
                        Promotions for POS &amp; the online shop. A coupon posts to the &ldquo;Coupon Discounts&rdquo; ledger.
                        Non-stackable coupons replace the spend-tier discount and block loyalty redemption.
                    </CardDescription>
                </div>
                {!adding && editId === null && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAdding(true)}>
                        <Plus size={14} className="mr-1" /> Add coupon
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                {adding && <CouponForm categories={categories} products={products} onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : coupons.length === 0 && !adding ? (
                    <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
                        No coupons yet — add one to run a promotion.
                    </div>
                ) : (
                    <ul className="divide-y rounded-lg border border-border/60">
                        {coupons.map((c) => (
                            editId === c.id ? (
                                <li key={c.id} className="p-3">
                                    <CouponForm initial={c} categories={categories} products={products} onSaved={() => { setEditId(null); load(); }} onCancel={() => setEditId(null)} />
                                </li>
                            ) : (
                                <li key={c.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${c.isActive ? "" : "opacity-50"}`}>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            {c.code
                                                ? <span className="font-mono text-sm font-semibold">{c.code}</span>
                                                : <Badge variant="outline" className="text-[10px]">AUTO</Badge>}
                                            <span className="truncate text-sm text-muted-foreground">{c.name}</span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                            <Badge className={`${channelTone[c.channels]} border-0`}>{c.channels === "BOTH" ? "POS+Shop" : c.channels}</Badge>
                                            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{valueSummary(c)}</span>
                                            {c.stackable && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">stackable</span>}
                                            {c.singleUse && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">single-use</span>}
                                            {c.eligibility !== "ANY" && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{c.eligibility.toLowerCase()}</span>}
                                            {c._count && c._count.redemptions > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{c._count.redemptions} used</span>}
                                        </div>
                                    </div>
                                    <Switch className="shrink-0" checked={c.isActive} onCheckedChange={(v) => patch(c.id, { isActive: v })} />
                                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { setAdding(false); setEditId(c.id); }}>
                                        <Pencil size={14} />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => remove(c.id)}>
                                        <Trash2 size={14} className="text-destructive" />
                                    </Button>
                                </li>
                            )
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
