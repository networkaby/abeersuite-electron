"use client";

// ── PosOffersPanel ────────────────────────────────────────────────────────────
// The POS "Offers" upsell panel: every claimable offer (server-computed by
// /api/pos/coupon-offers) with its live qualification progress, so the cashier
// can push the customer toward the next unlock ("add ₹200 more to unlock").
//
// Collapsed by default to keep the bill clean — the strip badge shows how many
// offers are ready vs close, and flashes when a new one becomes ready. Ready
// CODE offers get a one-click Apply (same path as typing the code).

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Gift, CheckCircle2, Flame, Ban, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/shared/lib/format";
import type { CouponHit, PosOffer } from "@/modules/pos/lib/posDraftTypes";

function OfferCard({
    o,
    applied,
    auto,
    onApply,
}: {
    o: PosOffer;
    applied: CouponHit | null;
    auto: CouponHit | null;
    onApply: (code: string) => void;
}) {
    const isApplied = applied?.couponId === o.couponId;
    const isAutoApplied = !isApplied && auto?.couponId === o.couponId;

    const frame =
        o.status === "ready"
            ? "border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-950/20"
            : o.status === "progress"
                ? "border-amber-300/50 bg-amber-50/40 dark:border-amber-500/25 dark:bg-amber-950/10"
                : "border-border bg-muted/30 opacity-70";

    return (
        <div className={`rounded border px-2.5 py-2 text-xs ${frame}`}>
            <div className="flex items-center gap-1.5">
                {o.status === "ready"
                    ? <CheckCircle2 size={13} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                    : o.status === "progress"
                        ? <Flame size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
                        : <Ban size={13} className="shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate font-medium">{o.benefit}</span>
                {isApplied ? (
                    <Badge className="border-transparent bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Applied</Badge>
                ) : o.applyMode === "AUTO" ? (
                    <Badge variant="secondary" className="text-[10px]"><Sparkles size={9} className="mr-0.5" />Auto</Badge>
                ) : o.status === "ready" && o.code ? (
                    <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onApply(o.code!)}>Apply</Button>
                ) : null}
            </div>
            {o.requirement && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">{o.requirement}</div>
            )}

            {o.status === "progress" && o.progress && (
                <div className="mt-1">
                    <div className="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                        <span>
                            {o.progress.unit === "₹"
                                ? `${formatInr(o.progress.current)} / ${formatInr(o.progress.target)}`
                                : `${o.progress.current} / ${o.progress.target} units`}
                        </span>
                        <span>{Math.min(100, Math.round(o.progress.pct))}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.min(100, Math.round(o.progress.pct))}%` }}
                        />
                    </div>
                </div>
            )}

            {o.status === "ready" && o.saveEstimate != null && (
                <div className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    Save {formatInr(o.saveEstimate)} on this cart
                </div>
            )}
            {o.status === "progress" && o.gapText && (
                <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{o.gapText}</div>
            )}
            {o.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{o.note}</div>}
            {o.status === "unavailable" && o.unavailableReason && (
                <div className="mt-0.5 text-[10px] text-muted-foreground/80">{o.unavailableReason}</div>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/70">
                {o.stackable
                    ? <span>Stackable</span>
                    : <span>{o.stackScope === "BILL" ? "Replaces tier · blocks loyalty" : "Line-scope exclusive"}</span>}
                {o.code && !isApplied && o.applyMode === "CODE" && <span className="font-mono">{o.code}</span>}
                {o.expiresAt && <span>ends {new Date(o.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>}
            </div>
        </div>
    );
}

export function PosOffersPanel({
    offers,
    appliedCoupon,
    autoCoupon,
    applyOffer,
}: {
    offers: PosOffer[] | null;
    appliedCoupon: CouponHit | null;
    autoCoupon: CouponHit | null;
    applyOffer: (code: string) => void;
}) {
    const [open, setOpen] = useState(false);
    // One-shot ring flash when a new offer flips to ready (the nudge).
    const [flash, setFlash] = useState(false);
    const prevReady = useRef<number>(-1);

    const total = offers?.length ?? 0;
    const readyCount = offers?.filter((o) => o.status === "ready").length ?? 0;
    const progressCount = offers?.filter((o) => o.status === "progress").length ?? 0;

    useEffect(() => {
        if (prevReady.current >= 0 && readyCount > prevReady.current) {
            setFlash(true);
            const t = setTimeout(() => setFlash(false), 1500);
            return () => clearTimeout(t);
        }
        prevReady.current = readyCount;
    }, [readyCount]);

    if (!offers || total === 0) return null;

    return (
        <div className="rounded-md border border-border/70 bg-card/60">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
            >
                <Gift size={13} className="shrink-0 text-primary" />
                <span className="font-semibold">Offers ({total})</span>
                <div className="ml-auto flex items-center gap-1.5">
                    {readyCount > 0 && (
                        <span
                            className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition-all dark:bg-emerald-500/15 dark:text-emerald-300 ${flash ? "ring-2 ring-emerald-400" : ""}`}
                        >
                            <CheckCircle2 size={10} /> {readyCount} ready
                        </span>
                    )}
                    {progressCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <Flame size={10} /> {progressCount} close
                        </span>
                    )}
                    <ChevronDown size={13} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                </div>
            </button>
            {open && (
                <div className="max-h-72 space-y-1.5 overflow-y-auto px-2.5 pb-2.5">
                    {offers.map((o) => (
                        <OfferCard key={o.couponId} o={o} applied={appliedCoupon} auto={autoCoupon} onApply={applyOffer} />
                    ))}
                </div>
            )}
        </div>
    );
}
