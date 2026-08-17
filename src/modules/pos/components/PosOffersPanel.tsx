"use client";

// ── PosOfferCard ──────────────────────────────────────────────────────────────
// One offer row for the POS "Upsell & Cross-sell" drawer. The qualification
// status + progress come from /api/pos/coupon-offers (server-owned gates);
// this card only renders + offers one-click Apply for ready CODE offers.

import { CheckCircle2, Flame, Ban, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/shared/lib/format";
import type { CouponHit, FreeGrantHit, PosOffer } from "@/modules/pos/lib/posDraftTypes";

export function PosOfferCard({
    o,
    applied,
    auto,
    appliedFree,
    autoFree,
    onApply,
    onApplyId,
}: {
    o: PosOffer;
    applied: CouponHit | null;
    auto: CouponHit | null;
    /// Independent FREE-GRANT coupon currently on the bill — its cards read "Applied".
    appliedFree: FreeGrantHit | null;
    /// Auto-applied free-grant coupon — its cards read "Applied" as well.
    autoFree: FreeGrantHit | null;
    onApply: (code: string) => void;
    /// Force-apply a specific AUTO offer by id (AUTO coupons have no code).
    onApplyId: (couponId: number) => void;
}) {
    const isApplied = applied?.couponId === o.couponId;
    // An AUTO offer the engine will apply at checkout reads as applied too.
    const isActiveAuto = !isApplied && auto?.couponId === o.couponId;
    // A free-grant offer applied on top reads as applied for its own card.
    const isFreeApplied = o.freeGrant && (appliedFree?.couponId === o.couponId || autoFree?.couponId === o.couponId);
    const appliedState = isApplied || isActiveAuto || isFreeApplied;
    // One-click apply code (ready CODE offers only) — captured so the click
    // closure keeps the string narrowing.
    const readyCode = o.status === "ready" && o.applyMode === "CODE" ? o.code : null;

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
                {o.freeGrant && (
                    <Badge className="shrink-0 border-transparent bg-emerald-600 text-[9px] text-white">FREE</Badge>
                )}
                {appliedState ? (
                    <Badge className="border-transparent bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Applied</Badge>
                ) : o.applyMode === "AUTO" ? (
                    // Qualified AUTO offer → the cashier can FORCE it onto the bill
                    // instead of letting the engine auto-pick (e.g. a different
                    // AUTO offer than the one auto-applied). Not ready → just Auto.
                    o.status === "ready" ? (
                        <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onApplyId(o.couponId)}>Apply</Button>
                    ) : (
                        <Badge variant="secondary" className="text-[10px]"><Sparkles size={9} className="mr-0.5" />Auto</Badge>
                    )
                ) : readyCode ? (
                    <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onApply(readyCode)}>Apply</Button>
                ) : null}
            </div>
            {/* The coupon's own name — so the cashier knows exactly which promotion this is. */}
            {o.name && (
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{o.name}</div>
            )}
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
                {o.freeGrant
                    ? <span>Free items — applies on top</span>
                    : o.stackable
                        ? <span>Stackable</span>
                        : <span>{o.stackScope === "BILL" ? "Replaces tier · blocks loyalty" : "Line-scope exclusive"}</span>}
                {/* The coupon's code — shown for every offer that has one, applied or not. */}
                {o.code && <span className="font-mono">{o.code}</span>}
                {o.expiresAt && <span>ends {new Date(o.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>}
            </div>
        </div>
    );
}
