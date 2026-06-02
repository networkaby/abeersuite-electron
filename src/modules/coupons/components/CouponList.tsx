"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Ticket, Share2, Printer, Image as ImageIcon, Download, MessageCircle, Mail, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CouponForm, type Coupon, type CategoryOpt, type ProductOpt } from "./CouponForm";
import {
    couponValueText, couponWhatsappUrl, couponWhatsappWebUrl, couponEmailUrl, type CouponShareInfo,
} from "@/modules/coupons/lib/couponShare";

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

export function CouponList({ categories, products, brandName }: { categories: CategoryOpt[]; products: ProductOpt[]; brandName: string }) {
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

    // ── Sharing (only coupons with a code) — mirrors the gift-card share flow ──
    function shareInfo(c: Coupon): CouponShareInfo {
        return {
            brandName, code: c.code ?? "", name: c.name, value: couponValueText(c),
            minBill: c.minBillValue != null ? Number(c.minBillValue) : null,
            validUntil: c.endsAt,
        };
    }
    function printCoupon(c: Coupon) {
        window.open(`/receipt/coupon/${c.id}`, "_blank", "noopener");
    }
    async function copyCode(c: Coupon) {
        try { await navigator.clipboard.writeText(c.code ?? ""); toast.success("Code copied"); }
        catch { toast.error("Couldn't copy"); }
    }
    async function fetchCouponImage(c: Coupon): Promise<File> {
        const res = await fetch(`/api/coupons/${c.id}/image`);
        if (!res.ok) throw new Error("image");
        const blob = await res.blob();
        return new File([blob], `coupon-${c.code}.png`, { type: "image/png" });
    }
    // Native share sheet with image + text (mobile / WhatsApp desktop app).
    async function shareCouponImage(c: Coupon) {
        const text = `${brandName} coupon — ${c.name}`;
        try {
            const file = await fetchCouponImage(c);
            const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
            if (nav.canShare && nav.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text, title: text });
                return;
            }
            const url = URL.createObjectURL(file);
            const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
            URL.revokeObjectURL(url);
            toast.info("Image downloaded — attach it to your message.");
            window.open(couponWhatsappUrl(shareInfo(c)), "_blank", "noopener");
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            toast.error("Couldn't share the image");
        }
    }
    // WhatsApp Web: copy PNG to clipboard (synchronously, Promise-valued
    // ClipboardItem) + open the chat with text prefilled → user pastes (Ctrl+V).
    async function shareWhatsappWebImage(c: Coupon) {
        const blobPromise = fetch(`/api/coupons/${c.id}/image`).then((r) => {
            if (!r.ok) throw new Error("image");
            return r.blob();
        });
        let copied = false;
        try {
            if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
                copied = true;
            }
        } catch { /* fall back to download */ }
        if (!copied) {
            try {
                const blob = await blobPromise;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `coupon-${c.code}.png`; a.click();
                URL.revokeObjectURL(url);
            } catch { toast.error("Couldn't generate the image"); return; }
        }
        window.open(couponWhatsappWebUrl(shareInfo(c)), "_blank", "noopener");
        toast.info(copied
            ? "Image copied — press Ctrl+V in the WhatsApp chat to attach it. The text is prefilled."
            : "Image downloaded — drag it into the WhatsApp chat. The text is prefilled.");
    }
    async function downloadImage(c: Coupon) {
        try {
            const file = await fetchCouponImage(c);
            const url = URL.createObjectURL(file);
            const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
            URL.revokeObjectURL(url);
        } catch { toast.error("Couldn't generate the image"); }
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

                                    {/* Share + print (code coupons only — AUTO coupons have no code) */}
                                    {c.code && (
                                        <>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Share"><Share2 size={14} /></Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-52">
                                                    <DropdownMenuItem onSelect={() => shareCouponImage(c)}><ImageIcon size={14} className="mr-2" /> Share with image</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => shareWhatsappWebImage(c)}><MessageCircle size={14} className="mr-2" /> WhatsApp Web (image)</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => downloadImage(c)}><Download size={14} className="mr-2" /> Download image</DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem asChild>
                                                        <a href={couponWhatsappUrl(shareInfo(c))} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} className="mr-2" /> WhatsApp (text)</a>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem asChild>
                                                        <a href={couponEmailUrl(shareInfo(c))}><Mail size={14} className="mr-2" /> Email (text)</a>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => copyCode(c)}><Copy size={14} className="mr-2" /> Copy code</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Print" onClick={() => printCoupon(c)}><Printer size={14} /></Button>
                                        </>
                                    )}

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
