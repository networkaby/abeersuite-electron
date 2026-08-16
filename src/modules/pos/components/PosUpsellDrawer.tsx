"use client";

// ── PosUpsellDrawer ───────────────────────────────────────────────────────────
// The "Upsell & Cross-sell" drawer — opens LEFT from the right edge (over the
// cart) via the trigger in the customer profile panel. Two sections:
//
//   • Offers to pitch — every claimable offer with live qualification progress
//     (server-computed by /api/pos/coupon-offers) + one-click Apply for ready
//     CODE offers. This is the "push the customer to buy more" lever.
//
//   • Add-ons — cross-sell: the customer's most recently bought products, topped
//     up with the store's best sellers (fallback: same-shelf items). Server
//     picks them; one tap to add. Quick accessory/AMC/consumable pitch.
//
// Backdrop click or Esc closes it.

import { useEffect } from "react";
import { X, Sparkles, PackagePlus, Flame, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/shared/lib/format";
import type { CouponHit, PosOffer, ProductOption } from "@/modules/pos/lib/posDraftTypes";
import { PosOfferCard } from "@/modules/pos/components/PosOffersPanel";

export function PosUpsellDrawer({
    open,
    onClose,
    offers,
    appliedCoupon,
    autoCoupon,
    applyOffer,
    crossSell,
    addToCart,
}: {
    open: boolean;
    onClose: () => void;
    offers: PosOffer[] | null;
    appliedCoupon: CouponHit | null;
    autoCoupon: CouponHit | null;
    applyOffer: (code: string) => void;
    crossSell: ProductOption[];
    addToCart: (p: ProductOption) => void;
}) {
    // Esc closes the drawer.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, onClose]);

    const readyCount = offers?.filter((o) => o.status === "ready").length ?? 0;

    return (
        <>
            {/* Backdrop — fades in; blocks interaction with the counter behind. */}
            <div
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
            />
            {/* The drawer — slides in from the right edge, opening to the left. */}
            <aside
                className={`fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
                aria-hidden={!open}
                inert={!open}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                    <Sparkles size={15} className="shrink-0 text-primary" />
                    <h3 className="text-sm font-semibold">Upsell &amp; Cross-sell</h3>
                    <span className="ml-auto flex items-center gap-1.5">
                        {readyCount > 0 && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                {readyCount} ready
                            </span>
                        )}
                        <Button size="icon-xs" variant="ghost" onClick={onClose} title="Close (Esc)">
                            <X size={14} />
                        </Button>
                    </span>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                    {/* Offers to pitch — the upsell lever. */}
                    <section>
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <Sparkles size={10} /> Offers to pitch
                        </div>
                        {!offers || offers.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                                No active offers on the counter right now.
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {offers.map((o) => (
                                    <PosOfferCard key={o.couponId} o={o} applied={appliedCoupon} auto={autoCoupon} onApply={applyOffer} />
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Add-ons — the cross-sell lever. */}
                    <section>
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <PackagePlus size={10} /> Add-ons
                        </div>
                        {crossSell.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                                No suggestions yet.
                            </div>
                        ) : (
                            <ul className="space-y-1.5">
                                {crossSell.map((p) => {
                                    const price = p.effectiveSalePricePaise != null ? p.effectiveSalePricePaise / 100 : null;
                                    const isHistory = p.crossSellSource === "history";
                                    const isHot = p.crossSellSource === "hot";
                                    // Last-purchase snapshot for history rows.
                                    const lastDate = p.lastBoughtAt ? new Date(p.lastBoughtAt) : null;
                                    const lastPrice = p.lastUnitPricePaise != null ? p.lastUnitPricePaise / 100 : null;
                                    const frame = isHistory
                                        ? "border border-l-4 border-l-emerald-500 border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-950/30"
                                        : isHot
                                            ? "border border-l-4 border-l-amber-500 border-amber-200/70 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20"
                                            : "border border-border bg-card";
                                    return (
                                        <li key={p.id} className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-xs ${frame}`}>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    {isHistory
                                                        ? <History size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                                                        : isHot
                                                            ? <Flame size={11} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                                            : null}
                                                    <div className="min-w-0 flex-1 truncate font-medium">{p.name}</div>
                                                    {isHistory ? (
                                                        <Badge className="shrink-0 border-transparent bg-emerald-100 text-[9px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                            Bought before
                                                        </Badge>
                                                    ) : isHot ? (
                                                        <Badge className="shrink-0 border-transparent bg-amber-100 text-[9px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                                            Popular
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                <div className="mt-0.5 text-[10px] text-muted-foreground">
                                                    {isHistory && lastDate ? (
                                                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                                                            {lastDate.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                                                            {lastPrice != null ? ` · paid ${formatInr(lastPrice)}` : ""}
                                                        </span>
                                                    ) : isHot ? (
                                                        <span className="font-medium text-amber-700 dark:text-amber-300">Moving fast · {p.sku}</span>
                                                    ) : p.sku}
                                                </div>
                                            </div>
                                            <span className="shrink-0 text-xs font-semibold tabular-nums">
                                                {price != null ? formatInr(price) : "—"}
                                            </span>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 shrink-0 px-2 text-[11px]"
                                                onClick={() => addToCart(p)}
                                                title={`Add ${p.name} to cart`}
                                            >
                                                + Add
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>
            </aside>
        </>
    );
}
