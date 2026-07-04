"use client";

// Shared POS bill-summary footer — the Subtotal → discounts → coupon / gift-card
// → Adjustments form → Total → Checkout block. It was a ~320-line byte-identical
// copy in PosScreen (Sale) and PosQuoteScreen (Order / Estimate); the only real
// difference between the two was the Checkout button (its label + onClick vary by
// mode), so that is injected by each screen via `checkoutSlot`.
//
// Every value the markup uses is passed in as an explicitly-named prop and the
// JSX below is the original verbatim — so behaviour and wiring are unchanged.

import type { Dispatch, SetStateAction } from "react";
import {
    ChevronDown, ChevronRight, Award, Plus, Tag, X, Sparkles, CreditCard,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { formatInr, parseDecimalInput, parseDigitsInput } from "@/shared/lib/format";
import { newChargeRow, type Snapshot, type CartLine, type ChargeRow, type CouponHit } from "@/modules/pos/lib/posDraftTypes";

type GiftCardState = { id: number; code: string; balance: number };

// Local text-input sanitisers — identical to the ones in the screens (small, pure).
function parseAmt(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}
function numSignedStr(s: string): string {
    const sign = s.trimStart().startsWith("-") ? "-" : "";
    return sign + parseDecimalInput(s);
}

export type PosBillSummaryProps = {
    // Totals
    subtotal: number;
    tax: number;
    total: number;
    totalDiscount: number;
    discountPct: number;
    discountAmount: number;

    // Snapshot + loyalty redemption
    snapshot: Snapshot | null;
    rates: Snapshot["loyaltyRates"];
    canRedeem: boolean;
    loyaltyBalance: number;
    redeemBlocked: boolean;
    maxRedeemablePts: number;
    redeemOn: boolean;
    setRedeemOn: Dispatch<SetStateAction<boolean>>;
    redeemPointsStr: string;
    setRedeemPointsStr: Dispatch<SetStateAction<string>>;
    effRedemptionRupees: number;

    // Coupon
    appliedCoupon: CouponHit | null;
    setAppliedCoupon: Dispatch<SetStateAction<CouponHit | null>>;
    autoCoupon: CouponHit | null;
    couponRupees: number;
    couponDroppedTier: boolean;
    couponBlockedLoyalty: boolean;
    couponCodeStr: string;
    setCouponCodeStr: Dispatch<SetStateAction<string>>;
    applyCoupon: () => void | Promise<void>;
    couponBusy: boolean;

    // Gift card
    giftCard: GiftCardState | null;
    setGiftCard: Dispatch<SetStateAction<GiftCardState | null>>;
    giftCardCodeStr: string;
    setGiftCardCodeStr: Dispatch<SetStateAction<string>>;
    applyGiftCard: () => void | Promise<void>;
    gcBusy: boolean;
    giftCardApplied: number;
    payableTotal: number;

    // Adjustments (shipping / round-off / charges)
    adjustmentsOpen: boolean;
    setAdjustmentsOpen: Dispatch<SetStateAction<boolean>>;
    shippingAmt: number;
    shippingAmtStr: string;
    setShippingAmtStr: (v: SetStateAction<string>) => void;
    roundOff: number;
    autoRoundOff: number;
    roundOffStr: string;
    setRoundOffStr: (v: SetStateAction<string>) => void;
    roundOffManuallyEdited: boolean;
    setRoundOffManuallyEdited: (v: SetStateAction<boolean>) => void;
    charges: ChargeRow[];
    setCharges: (v: SetStateAction<ChargeRow[]>) => void;
    chargeAccounts: GlAccount[];

    // Cart + the mode-specific checkout button
    cart: CartLine[];
    checkoutSlot: React.ReactNode;
};

export function PosBillSummary({
    subtotal, tax, total, totalDiscount, discountPct, discountAmount,
    snapshot, rates, canRedeem, loyaltyBalance, redeemBlocked, maxRedeemablePts,
    redeemOn, setRedeemOn, redeemPointsStr, setRedeemPointsStr, effRedemptionRupees,
    appliedCoupon, setAppliedCoupon, autoCoupon, couponRupees, couponDroppedTier,
    couponBlockedLoyalty, couponCodeStr, setCouponCodeStr, applyCoupon, couponBusy,
    giftCard, setGiftCard, giftCardCodeStr, setGiftCardCodeStr, applyGiftCard, gcBusy,
    giftCardApplied, payableTotal,
    adjustmentsOpen, setAdjustmentsOpen, shippingAmt, shippingAmtStr, setShippingAmtStr,
    roundOff, autoRoundOff, roundOffStr, setRoundOffStr, roundOffManuallyEdited,
    setRoundOffManuallyEdited, charges, setCharges, chargeAccounts,
    cart, checkoutSlot,
}: PosBillSummaryProps) {
    return (
        <div className="shrink-0 space-y-2 border-t border-border p-4">
            {/* Subtotal is the tax-INCLUSIVE cart value (price-tag-style).
                When the operator hasn't added shipping / round-off / charges,
                Subtotal equals Total. The CGST/SGST split underneath is
                informational — cashiers and printed receipts show the breakdown
                but the math has already happened in the per-line inclusive price. */}
            {/* Subtotal — the tax (incl.) SGST/CGST breakdown rides in the
                middle of this bar so it no longer needs its own row. */}
            <div className="flex items-center gap-3 text-sm">
                <span>Subtotal</span>
                {/* Adjustments toggle — inline on the Subtotal line so it
                    no longer eats its own row. The Shipping / Round-off /
                    Charges form drops in below when opened. */}
                {(() => {
                    const adjustmentsCount =
                        (shippingAmt > 0 ? 1 : 0) +
                        (Math.abs(roundOff) >= 0.005 ? 1 : 0) +
                        charges.filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005).length;
                    return (
                        <button
                            type="button"
                            onClick={() => setAdjustmentsOpen((o) => !o)}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Adjustments — Shipping · Round-off · Charges"
                        >
                            {adjustmentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Adjustments
                            {adjustmentsCount > 0 && (
                                <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{adjustmentsCount}</Badge>
                            )}
                        </button>
                    );
                })()}
                <div className="ml-auto flex items-center gap-3">
                    {tax > 0.005 && (
                        <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                            incl. GST · SGST {formatInr(tax / 2)} + CGST {formatInr(tax / 2)} = {formatInr(tax)}
                        </span>
                    )}
                    <span className="font-medium">{formatInr(subtotal + tax)}</span>
                </div>
            </div>
            {/* Discounts — each kind is its own chip, joined by a "+" since
                they add up. One flex-wrap row; extra discount types wrap to
                the next line instead of each eating a full row. */}
            {(() => {
                const chips: React.ReactNode[] = [];
                // Tier discount — automatic, display-only
                if (discountPct > 0) {
                    chips.push(
                        <span key="tier" className={`inline-flex items-center gap-1.5 ${couponDroppedTier ? "text-muted-foreground line-through opacity-60" : "text-emerald-600 dark:text-emerald-400"}`}>
                            <span
                                className="cursor-help underline decoration-dotted underline-offset-2"
                                title={couponDroppedTier
                                    ? "Tier discount is replaced by the applied non-stackable coupon."
                                    : `Automatic ${snapshot?.customerLevel || "spend"}-tier discount from lifetime spend, applied on pre-GST goods. Configured under Customer Tiers; separate from loyalty points.`}
                            >
                                Level Discount ({snapshot?.customerLevel ? `${snapshot.customerLevel} ` : ""}{discountPct}%)
                            </span>
                            <span className="font-medium tabular-nums">− {formatInr(discountAmount)}</span>
                        </span>,
                    );
                }
                // Loyalty redemption — interactive (tick + points input). The
                // resulting − ₹ rides inside this same chip, so it no longer
                // needs a separate "Points redeemed" row.
                if (canRedeem && loyaltyBalance > 0) {
                    chips.push(
                        <span key="redeem" className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Label htmlFor="pos-redeem-tick" className="inline-flex items-center h-5 gap-1.5">
                                <Checkbox
                                    id="pos-redeem-tick"
                                    checked={redeemOn && !couponBlockedLoyalty}
                                    disabled={redeemBlocked || couponBlockedLoyalty}
                                    onCheckedChange={(v) => {
                                        const on = v === true;
                                        setRedeemOn(on);
                                        // Tick → apply the most the customer can actually redeem:
                                        // the smaller of their balance and the cart's cap (editable).
                                        setRedeemPointsStr(on ? String(Math.min(maxRedeemablePts, loyaltyBalance)) : "");
                                    }}
                                />
                                <Award size={12} /> Redeem points
                            </Label>
                            {redeemOn && !redeemBlocked && !couponBlockedLoyalty && (
                                <Input
                                    id="pos-redeem"
                                    type="text"
                                    inputMode="numeric"
                                    value={redeemPointsStr}
                                    onChange={(e) => setRedeemPointsStr(parseDigitsInput(e.target.value))}
                                    placeholder="0"
                                    className="h-5 w-20 text-right text-xs"
                                />
                            )}
                            <span className="text-[10px] opacity-70">
                                {couponBlockedLoyalty
                                    ? "(blocked by coupon)"
                                    : redeemBlocked
                                        ? `(redeem from ${formatInr(rates?.minRedeemInvoiceValue ?? 0)})`
                                        : `(${loyaltyBalance} avail · ${formatInr(rates?.redeemValue ?? 0)}/pt)`}
                            </span>
                            {effRedemptionRupees > 0.005 && (
                                <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {formatInr(effRedemptionRupees)}</span>
                            )}
                        </span>,
                    );
                }
                if (chips.length === 0) return null;
                return (
                    <div className="flex items-start justify-between gap-3 text-xs">
                        {/* breakdown chips on the left, "+" between chips only */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            {chips.flatMap((chip, i) =>
                                i === 0
                                    ? [chip]
                                    : [<Plus key={`sep-${i}`} size={11} className="shrink-0 text-muted-foreground/40" />, chip],
                            )}
                        </div>
                        {/* combined total on the right of the SAME line */}
                        {totalDiscount > 0.005 && (
                            <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                                Total discount − {formatInr(totalDiscount)}
                            </span>
                        )}
                    </div>
                );
            })()}

            {/* Coupon + Gift card share one row to save vertical space. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                {/* ── Coupon ────────────────────────────────────────
                Code entry; the server validates + owns the ₹ value.
                A non-stackable coupon replaces the tier discount and
                blocks loyalty (shown struck-through above). */}
                {snapshot && (
                    <div className="flex items-center gap-2 text-xs">
                        <Tag size={12} className="shrink-0 text-muted-foreground" />
                        {appliedCoupon ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                                    {appliedCoupon.code ?? "AUTO"}
                                </span>
                                <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {formatInr(couponRupees)}</span>
                                {couponDroppedTier && <span className="text-[10px] text-amber-600 dark:text-amber-400">replaces tier</span>}
                                {couponBlockedLoyalty && <span className="text-[10px] text-amber-600 dark:text-amber-400">blocks loyalty</span>}
                                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setAppliedCoupon(null); setCouponCodeStr(""); }}>
                                    <X size={12} />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                {autoCoupon && (
                                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                        <Sparkles size={11} /> Auto offer{autoCoupon.code ? ` ${autoCoupon.code}` : ""} · − {formatInr(autoCoupon.rupees)}
                                    </span>
                                )}
                                <Input
                                    value={couponCodeStr}
                                    onChange={(e) => setCouponCodeStr(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyCoupon(); } }}
                                    placeholder="Coupon code"
                                    className="h-7 w-36 font-mono text-xs"
                                />
                                <Button size="sm" variant="outline" className="h-7" disabled={couponBusy || !couponCodeStr.trim()} onClick={() => void applyCoupon()}>
                                    Apply
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Gift card (payment tender) ─────────────────────
                Draws min(balance, bill) toward the total; the cashier
                collects the remaining "Pay" amount in cash/UPI. */}
                {snapshot && (
                    <div className="flex items-center gap-2 text-xs">
                        <CreditCard size={12} className="shrink-0 text-muted-foreground" />
                        {giftCard ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                                    {giftCard.code}
                                </span>
                                <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {formatInr(giftCardApplied)}</span>
                                <span className="text-[10px] text-muted-foreground">bal {formatInr(Math.max(0, giftCard.balance - giftCardApplied))} after</span>
                                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setGiftCard(null); setGiftCardCodeStr(""); }}>
                                    <X size={12} />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <Input
                                    value={giftCardCodeStr}
                                    onChange={(e) => setGiftCardCodeStr(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void applyGiftCard(); } }}
                                    placeholder="Gift card code"
                                    className="h-7 w-36 font-mono text-xs"
                                />
                                <Button size="sm" variant="outline" className="h-7" disabled={gcBusy || !giftCardCodeStr.trim()} onClick={() => void applyGiftCard()}>
                                    Redeem
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {giftCardApplied > 0.005 && (
                <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-muted-foreground">Pay (after gift card)</span>
                    <span className="tabular-nums">{formatInr(payableTotal)}</span>
                </div>
            )}

            {/* Adjustments form — Shipping + Round-off + Charges.
                Toggled from the inline "Adjustments" control on the
                Subtotal line above (kept off its own row to save space).
                Mirrors office SALE (TradingVoucherPage). */}
            {adjustmentsOpen && (
                <div className="space-y-2 rounded border border-border/60 bg-muted/30 px-2 py-2">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <Label htmlFor="pos-shipping" className="text-xs text-muted-foreground">Shipping</Label>
                        <Input
                            id="pos-shipping"
                            type="text"
                            inputMode="decimal"
                            value={shippingAmtStr}
                            onChange={(e) => setShippingAmtStr(parseDecimalInput(e.target.value))}
                            placeholder="0.00"
                            className="h-7 w-28 text-right text-xs"
                        />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <Label htmlFor="pos-roundoff" className="text-xs text-muted-foreground">
                            Round-off
                            {!roundOffManuallyEdited && Math.abs(autoRoundOff) >= 0.005 && (
                                <span className="ml-1 text-[10px] text-emerald-600">auto</span>
                            )}
                        </Label>
                        <Input
                            id="pos-roundoff"
                            type="text"
                            inputMode="decimal"
                            value={
                                roundOffManuallyEdited
                                    ? roundOffStr
                                    : (Math.abs(autoRoundOff) >= 0.005 ? autoRoundOff.toFixed(2) : "")
                            }
                            onChange={(e) => {
                                setRoundOffManuallyEdited(true);
                                setRoundOffStr(numSignedStr(e.target.value));
                            }}
                            placeholder="auto"
                            className="h-7 w-28 text-right text-xs"
                            title="Auto-rounded to whole rupee. Type a value to override; clear to restore auto."
                            onBlur={(e) => {
                                // Empty field → back to auto mode.
                                if (e.target.value.trim() === "") {
                                    setRoundOffManuallyEdited(false);
                                    setRoundOffStr("");
                                }
                            }}
                        />
                    </div>
                    <div className="space-y-1.5 border-t border-border/60 pt-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Additional charges</p>
                        {charges.map((c, idx) => (
                            <div key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                                <GlAccountCombobox
                                    value={c.accountId}
                                    onChange={(acc) => setCharges((rows) => rows.map((r, i) => i === idx ? { ...r, accountId: acc?.id ?? null } : r))}
                                    accounts={chargeAccounts}
                                    placeholder="Ledger (e.g. Packing Income)"
                                    className="h-7 text-xs"
                                />
                                <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={c.amount}
                                    onChange={(e) => setCharges((rows) => rows.map((r, i) => i === idx ? { ...r, amount: numSignedStr(e.target.value) } : r))}
                                    placeholder="0 (− for opposite)"
                                    className="h-7 w-24 text-right text-xs"
                                    title="Positive = Cr (Income); Negative = Dr (Expense / reduces bill)"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setCharges((rows) => rows.filter((_, i) => i !== idx))}
                                    title="Remove"
                                >
                                    <X size={12} />
                                </Button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setCharges((rows) => [...rows, newChargeRow()])}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                            + Add charge
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-baseline justify-between border-t border-border pt-2.5">
                <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold">Total</span>
                    {cart.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">{cart.length} item{cart.length > 1 ? "s" : ""}</span>
                    )}
                </div>
                <span className="text-xl font-bold tabular-nums">{formatInr(total)}</span>
            </div>
            {checkoutSlot}
        </div>
    );
}
