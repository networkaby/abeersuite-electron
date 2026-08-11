"use client";

// ── usePosBilling ─────────────────────────────────────────────────────────────
// The shared POS billing engine — everything PosScreen (Sale) and PosQuoteScreen
// (Order / Estimate) had in duplicate: customer snapshot, product search + cart,
// bill math (tier / loyalty / coupon / gift card / round-off via the SAME
// calcVoucherTotals the server uses), tender math, shift lifecycle state, and the
// customer-display coordinator. The screens keep only what really differs:
// their submit routine (sale vs order/estimate endpoints), edit hydration, and
// the checkout dialog wiring.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { calcVoucherTotals, calcLineTotals, resolveShippingGstRate } from "@/modules/inventory/lib/stock";
import { type PartySearchAndCreateHandle, type PickedParty } from "@/shared/components/PartySearchAndCreate";
import { type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { type PendingHandover } from "@/modules/pos/components/HandoverAcceptDialog";
import { type TenderSplit } from "@/modules/pos/components/TenderSplitInput";
import { usePosAccess } from "@/modules/pos/hooks/usePosAccess";
import { usePosCustomerDisplay } from "@/modules/pos/hooks/usePosCustomerDisplay";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { DEFAULT_PAYEE_NAME } from "@/modules/pos/lib/paymentLink";
import { formatInr, parseDigitsInput, round2 } from "@/shared/lib/format";
import { resolveTierTitles } from "@/shared/lib/pricing";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type Snapshot, type ProductOption, type PosServiceOption, type CartLine, type CouponHit } from "@/modules/pos/lib/posDraftTypes";
import { productMatchesQuery } from "@/shared/lib/inventory";

// Text-input sanitiser — same shape as TradingVoucherPage's num.
// Project rule: no <input type="number">; we keep raw strings in state and
// parse on submit / when computing totals.
export function parseAmt(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

export function usePosBilling(opts: {
    /** Ctrl/Cmd+Enter dispatch — called only when the shared guards pass
     * (no dialog open, cart non-empty, customer picked). Each screen decides
     * what "confirm" means (open checkout / save directly / PATCH an edit). */
    onHotkeyConfirm: () => void;
    /** Created by the screen (never returned from here — a hook return carrying
     * ref objects taints every property access under react-hooks/refs). */
    partySearchRef: React.RefObject<PartySearchAndCreateHandle | null>;
    productSearchRef: React.RefObject<HTMLInputElement | null>;
    cashTenderedRef: React.RefObject<HTMLInputElement | null>;
}) {
    const { partySearchRef, productSearchRef, cashTenderedRef } = opts;
    // POS UI access flags (hide controls the operator lacks). UI-gating only.
    const posAccess = usePosAccess();

    // ── Customer search omnibox (delegated to shared component) ─────────────
    // snapshot + cart + bill adjustments live in the shared POS draft store so
    // they survive a mode switch between Sale / Order / Estimate.
    const snapshot = usePosDraftStore((s) => s.snapshot);
    const setSnapshot = usePosDraftStore((s) => s.setSnapshot);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);

    // ── Product search + cart ───────────────────────────────────────────────
    const [productQuery, setProductQuery] = useState("");
    const [productHighlight, setProductHighlight] = useState(0);
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    // Active POS-service catalogue (Settings → POS Services) — surfaced in the
    // same search list AFTER product matches, added to the cart like products.
    const [allServices, setAllServices] = useState<PosServiceOption[]>([]);
    const cart = usePosDraftStore((s) => s.cart);
    const setCart = usePosDraftStore((s) => s.setCart);

    // ── Checkout / payment splits ───────────────────────────────────────────
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [shareVpa, setShareVpa] = useState<string | null>(null);
    const [pay, setPay] = useState({ cashTendered: 0, cashReturn: 0 });
    const [splits, setSplits] = useState<TenderSplit[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // ── Cart-level adjustments (shipping / round-off / charges) ────────────
    const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
    const shippingAmtStr = usePosDraftStore((s) => s.shippingAmtStr);
    const setShippingAmtStr = usePosDraftStore((s) => s.setShippingAmtStr);
    // Loyalty points the cashier is redeeming on this bill (whole-number string).
    const [redeemPointsStr, setRedeemPointsStr] = useState("");
    const [redeemOn, setRedeemOn] = useState(false); // tick to apply loyalty redemption
    // Coupon — code entry; the server validates + owns the ₹ value.
    const [couponCodeStr, setCouponCodeStr] = useState("");
    const [appliedCoupon, setAppliedCoupon] = useState<CouponHit | null>(null);
    // Best auto-apply offer (no code) — used only when no manual coupon is applied.
    const [autoCoupon, setAutoCoupon] = useState<CouponHit | null>(null);
    const [couponBusy, setCouponBusy] = useState(false);
    // Gift card redeemed as a payment tender (reduces cash/UPI due, not a discount).
    const [giftCardCodeStr, setGiftCardCodeStr] = useState("");
    const [giftCard, setGiftCard] = useState<{ id: number; code: string; balance: number } | null>(null);
    const [gcBusy, setGcBusy] = useState(false);
    const roundOffStr = usePosDraftStore((s) => s.roundOffStr);
    const setRoundOffStr = usePosDraftStore((s) => s.setRoundOffStr);
    // Vyapar-style auto round-off: POS auto-derives the round-off to land Total
    // on a whole rupee; a manually typed value sticks.
    const roundOffManuallyEdited = usePosDraftStore((s) => s.roundOffManuallyEdited);
    const setRoundOffManuallyEdited = usePosDraftStore((s) => s.setRoundOffManuallyEdited);
    const charges = usePosDraftStore((s) => s.charges);
    const setCharges = usePosDraftStore((s) => s.setCharges);
    const resetDraft = usePosDraftStore((s) => s.reset);
    const ticketId = usePosDraftStore((s) => s.ticketId);
    const setTicketId = usePosDraftStore((s) => s.setTicketId);

    // ── Active POS shift ────────────────────────────────────────────────────
    // Mount order:
    //   1. GET /api/pos/shifts/current
    //      → OPEN            : show ActiveShiftBar (billing enabled)
    //      → AWAITING_HANDOVER: show ActiveShiftBar in amber mode (billing blocked)
    //      → null            : check for pending handover ↓
    //   2. GET /api/pos/shifts/pending-handover
    //      → found           : show HandoverAcceptDialog (B accepts A's handover)
    //      → null            : show ShiftOpenDialog (fresh start)
    const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
    const [pendingHandover, setPendingHandover] = useState<PendingHandover | null>(null);
    const [shiftLoaded, setShiftLoaded] = useState(false);
    const [shiftOpenDialogOpen, setShiftOpenDialogOpen] = useState(false);
    const [returnDialogOpen, setReturnDialogOpen] = useState(false);
    const [expenditureDialogOpen, setExpenditureDialogOpen] = useState(false);
    const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
    // Shift drop / close — launched from the header ⋮ menu.
    const [shiftDropOpen, setShiftDropOpen] = useState(false);
    const [shiftCloseOpen, setShiftCloseOpen] = useState(false);

    const refreshActiveShift = useCallback(() => {
        axios.get<ActiveShift | null>("/api/pos/shifts/current")
            .then(async (r) => {
                if (r.data) {
                    setActiveShift(r.data);
                    setPendingHandover(null);
                } else {
                    setActiveShift(null);
                    // Check if B has a handover waiting.
                    try {
                        const h = await axios.get<PendingHandover | null>("/api/pos/shifts/pending-handover");
                        setPendingHandover(h.data);
                    } catch {
                        setPendingHandover(null);
                    }
                }
            })
            .catch(() => { setActiveShift(null); setPendingHandover(null); })
            .finally(() => setShiftLoaded(true));
    }, []);

    useEffect(() => {
        refreshActiveShift();
    }, [refreshActiveShift]);

    // The counter's non-cash payment accounts (UPI 1 → HDFC, UPI 2 → SBI, Card…),
    // configured under /office/admin/counters. Each checkout split picks one of
    // these. Cash is always accepted (routes to till) and isn't in this list.
    const payAccounts = useMemo(() => activeShift?.counter.paymentAccounts ?? [], [activeShift]);
    const payAccountById = useMemo(
        () => new Map(payAccounts.map((a) => [a.id, a])),
        [payAccounts],
    );

    // ── Effects ─────────────────────────────────────────────────────────────

    // Load all products once for fast typing
    useEffect(() => {
        axios.get<ProductOption[]>("/api/inventory/products/lookup")
            .then((r) => setAllProducts(r.data))
            .catch(() => { /* page is still useful without it */ });
    }, []);

    // Load the active POS services once — added via the "+ Add service charge"
    // button in the cart (not the product search — services have no barcode).
    useEffect(() => {
        axios.get<PosServiceOption[]>("/api/pos/services")
            .then((r) => setAllServices(r.data))
            .catch(() => { /* page is still useful without them */ });
    }, []);

    // Ctrl/Cmd+Enter from anywhere → the screen's confirm action (skip when
    // modals are already open). The dispatch lives in a ref so the listener
    // always sees the latest closure without re-binding on every render.
    const hotkeyConfirmRef = useRef(opts.onHotkeyConfirm);
    useEffect(() => {
        hotkeyConfirmRef.current = opts.onHotkeyConfirm;
    });
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (createDialogOpen || checkoutOpen) return;
            if (cart.length === 0 || !snapshot?.account) return;
            e.preventDefault();
            hotkeyConfirmRef.current();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [cart.length, snapshot?.account, createDialogOpen, checkoutOpen]);

    // Suppresses the display coordinator while the thank-you screen is holding.
    // After a successful sale, we want the green "Thank You ₹X" frame to stay
    // for thankyouDurationMs (relay-side default 4s); without this flag, the
    // coordinator effect would immediately push the next screen (customer
    // welcome) and overwrite it.
    const [displayHold, setDisplayHold] = useState<"thankyou" | null>(null);

    // Leaving the POS page → release the display back to its slideshow.
    useEffect(() => {
        return () => { void qrDisplay.idle(); };
    }, []);

    // ── Computed ────────────────────────────────────────────────────────────

    // Products only — services have no barcode, so they are NOT scannable/typed
    // here; they are added from the "+ Add service charge" button in the cart.
    const filteredProducts = useMemo(() => {
        const q = productQuery.trim();
        if (!q) return [] as ProductOption[];
        return allProducts
            .filter((p) => productMatchesQuery(p, q))
            .slice(0, 8);
    }, [productQuery, allProducts]);

    // Per-line tax via the same calcLineTotals helper office SALE uses, so
    // POS and SALE always compute identical GST. POS has no per-line discount
    // today (only voucher-level loyalty %) so discountPct/Amt are 0 here.
    const lineRows = cart.map((l) => {
        const { taxAmount, amount } = calcLineTotals({
            quantity: l.qty,
            rate: l.unitPrice,
            discountPct: 0,
            discountAmt: 0,
            taxRate: l.taxRate,
        });
        return { amount, taxAmount, gross: l.qty * l.unitPrice };
    });
    const subtotal = lineRows.reduce((s, l) => s + l.gross, 0);   // pre-tax goods value
    const tax = lineRows.reduce((s, l) => s + l.taxAmount, 0);
    const shippingAmt = Math.max(0, parseAmt(shippingAmtStr));
    // Shipping GST hint (display only — the server recomputes and owns it).
    // The typed shipping amount is tax-INCLUSIVE, so the total never moves;
    // this only surfaces the embedded GST: rate = dominant >50% goods rate,
    // else max rate; a service-only bill falls back to its service rates.
    // Weights are pre-tax qty × unitPrice — identical to the server's.
    const goodsRateLines = cart.filter((l) => l.kind !== "service");
    const shippingRateBase = (goodsRateLines.length > 0 ? goodsRateLines : cart)
        .map((l) => ({ value: l.qty * l.unitPrice, taxRate: l.taxRate }));
    const shippingGstRate = shippingAmt > 0 ? resolveShippingGstRate(shippingRateBase) : 0;
    const shippingTaxAmt = (shippingAmt * shippingGstRate) / (100 + shippingGstRate);
    const manualChargesNet = charges.reduce((s, c) => s + parseAmt(c.amount), 0);

    // ── Spend tiers, resolved live ────────────────────────────────────────────
    // A CURRENT_SALE period scores the bill on the counter, so the discount moves as
    // items are scanned — a first-time customer can earn a level on the very bill that
    // earns it. Bracket periods ignore the cart and just use their ledger spend.
    //
    // currentSaleValue is the bill BEFORE any discount (goods + tax + shipping +
    // charges). It has to be pre-discount: the discount is what we're resolving, so
    // feeding the discounted total back in would be circular. It's the closest honest
    // stand-in for what the bill will post as — it differs by the discount itself.
    //
    // /api/pos/sale re-runs this same resolver on the posted lines and uses ITS answer,
    // so a tampered browser cannot award itself a discount.
    const currentSaleValue = subtotal + tax + shippingAmt + manualChargesNet;
    const tier = resolveTierTitles({
        periods: snapshot?.tierPeriods ?? [],
        currentSaleValue,
        // Same definition the coupon engine uses for isNewCustomer — no posted bill yet.
        isNewCustomer: (snapshot?.turnover.invoiceCount ?? 0) === 0,
        capPct: snapshot?.tierCapPct ?? null,
    });
    const discountPct = tier.discountPct;

    // ── Spend-tier discount: a % of COST (incl. tax), applied per line BEFORE tax ──
    // Margin is a % of cost-incl (additivePrice), so the discount is too → margin%
    // and discount% at the same rate are the identical rupee amount (exact break-even).
    // Mechanically each line's taxable is cut by `discount% × costExcl × qty` and GST
    // recomputed on the reduced base (Sec 15(3)(a) trade discount, correct for mixed
    // rates). Cost is snapshotted on the line at add-to-cart; edited/converted carts
    // fall back to the product list. No cost basis → no discount on that line. No
    // margin floor (clearance may sell below cost); only clamp to the line gross so
    // taxable never goes negative. /api/pos/sale re-resolves cost from the ledger and
    // uses ITS answer, so the browser cannot inflate the discount.
    const lineCostExcl = (l: CartLine): number | null => {
        const paise = l.costPaise ?? allProducts.find((p) => p.id === l.productId)?.costPaise ?? null;
        return paise == null ? null : paise / 100;
    };
    const lineTierDiscExcl = cart.map((l) => {
        const c = lineCostExcl(l);
        if (c == null || discountPct <= 0) return 0;
        return Math.min((discountPct / 100) * c * l.qty, l.qty * l.unitPrice);
    });
    // Inclusive rupee effect shown on the bill = Σ (line gross incl − line net incl),
    // where the tax saving rides along. Feeding THIS as the voucher-level discount to
    // calcVoucherTotals yields the same total as netting per line (they're equal by
    // construction), so the client total still matches the server's per-line post.
    const discountAmount = cart.reduce((sum, l, i) => {
        const net = calcLineTotals({ quantity: l.qty, rate: l.unitPrice, discountPct: 0, discountAmt: lineTierDiscExcl[i], taxRate: l.taxRate }).amount;
        return sum + (lineRows[i].amount - net);
    }, 0);
    // Synthetic % for display — the discount as a share of the tag (incl. GST) the
    // customer sees; the configured "% of cost" never leaves admin surfaces.
    const grossIncl = subtotal + tax;
    const synthDiscountPct = grossIncl > 0 ? round2((discountAmount / grossIncl) * 100) : 0;

    // ── Loyalty redemption (mirrors the server) ───────────────────────────────
    // Redemption rides a negative charge to the dedicated "Loyalty Points
    // Redeemed" ledger, so it folds into chargesNet here exactly as the server
    // folds it into calcVoucherTotals. We clamp to balance + bill caps client-
    // side so we only ever send the route a value it will accept.
    const rates = snapshot?.loyaltyRates ?? null;
    // Redemption is live only while the programme AND its redeem gate are on.
    const canRedeem = !!rates?.enabled && !!rates?.redeemEnabled;
    const loyaltyBalance = snapshot?.loyaltyPoints ?? 0;
    const minRedeemPts = rates?.minRedeemPoints ?? 0;
    // Pre-redemption bill — used to enforce the min-invoice-to-redeem floor.
    const billBeforeRedemption = calcVoucherTotals(lineRows, shippingAmt, discountAmount, 0, manualChargesNet).totalAmount;
    const redeemBlocked = rates?.minRedeemInvoiceValue != null && billBeforeRedemption < rates.minRedeemInvoiceValue;
    // Cart-aware redeem ceiling — Σ (line net × that item's redeem cap %), with the
    // global cap as the per-line default (null → 100%). Mirrors the server's
    // redeemableBaseForCart so the bill total + payment check always agree.
    const globalCapPct = rates?.maxRedeemPctOfBill ?? null;
    // Loyalty redeems against GOODS only — service lines stay out of the base,
    // mirroring the server (earnLines / redeemableBaseForCart see body.lines,
    // which carry products only).
    const goodsCart = cart.filter((l) => l.kind !== "service");
    const cartGoods = goodsCart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const maxRedeemableRupees = cartGoods <= 0 ? 0 : goodsCart.reduce((acc, l) => {
        const lineGoods = l.qty * l.unitPrice;
        const allocated = discountAmount * (lineGoods / cartGoods);
        const net = Math.max(0, lineGoods - allocated);
        const cap = l.redeemCapPct ?? globalCapPct;
        const frac = cap == null ? 1 : Math.max(0, Math.min(100, cap)) / 100;
        return acc + net * frac;
    }, 0);
    const requestedPts = canRedeem && redeemOn && !redeemBlocked ? parseInt(parseDigitsInput(redeemPointsStr) || "0", 10) : 0;
    const maxRedeemablePts = rates && rates.redeemValue > 0 ? Math.floor(maxRedeemableRupees / rates.redeemValue) : 0;
    const cappedPts = Math.min(requestedPts, loyaltyBalance, maxRedeemablePts);
    const redeemPts = cappedPts >= minRedeemPts ? cappedPts : 0;
    const redemptionRupees = rates ? redeemPts * rates.redeemValue : 0;

    // ── Coupon (server-validated) ──────────────────────────────────────────────
    // A non-stackable coupon DROPS the tier discount + BLOCKS loyalty redemption;
    // the validate route already told us which, so mirror it in the bill so the
    // client total matches what the server will post.
    // Manual coupon wins; otherwise the best auto-apply offer (if any).
    const effectiveCoupon = appliedCoupon ?? autoCoupon;
    const couponRupees = effectiveCoupon?.rupees ?? 0;
    const couponDroppedTier = !!effectiveCoupon?.droppedTier;
    const couponBlockedLoyalty = !!effectiveCoupon?.blockedLoyalty;
    const effDiscountAmount = couponDroppedTier ? 0 : discountAmount;
    const effRedemptionRupees = couponBlockedLoyalty ? 0 : redemptionRupees;
    const effRedeemPts = couponBlockedLoyalty ? 0 : redeemPts;

    // Combined customer-facing discount (tier + loyalty redemption + coupon).
    const totalDiscount = effDiscountAmount + effRedemptionRupees + couponRupees;

    // Loyalty redemption + coupon both ride chargesNet as negative charges, exactly
    // as the server folds them into calcVoucherTotals.
    const chargesNet = manualChargesNet - effRedemptionRupees - couponRupees;
    // Auto round-off: figure out the round-off that lands Total on a whole
    // rupee by computing the pre-round total first, then deriving the delta.
    // If the cashier has manually typed a value, that override wins.
    const naturalTotal = calcVoucherTotals(lineRows, shippingAmt, effDiscountAmount, 0, chargesNet).totalAmount;
    const autoRoundOff = Math.round(naturalTotal) - naturalTotal;
    const roundOff = roundOffManuallyEdited ? parseAmt(roundOffStr) : autoRoundOff;
    // Single source of truth — matches /api/inventory/vouchers SALE math via
    // calcVoucherTotals, so server-side validation cannot disagree.
    const { totalAmount: total } = calcVoucherTotals(
        lineRows,                  // each row's `amount` is tax-inclusive
        shippingAmt,
        effDiscountAmount,
        roundOff,
        chargesNet,
    );

    // Gift card is a TENDER, not a discount — it doesn't change `total`, it covers
    // part of it. The cashier collects `payableTotal` in cash/UPI; the server draws
    // the same min(balance, total) from the card and posts it as a Dr-Liability tender.
    const giftCardApplied = giftCard ? Math.min(giftCard.balance, total) : 0;
    const payableTotal = Math.max(0, +(total - giftCardApplied).toFixed(2));

    // Bill-level adjustments shown on the customer ladder (print + display) so the
    // breakdown reconciles: manual charges + shipping + round-off (signed). Loyalty
    // /coupon are passed as their own discount fields, not here.
    const posExtraCharges: { label: string; amount: number }[] = [
        ...charges
            .filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005)
            .map((c) => ({ label: c.description?.trim() || "Charge", amount: parseAmt(c.amount) })),
        ...(shippingAmt > 0.005 ? [{ label: "Shipping", amount: shippingAmt }] : []),
        ...(Math.abs(roundOff) > 0.005 ? [{ label: "Round-off", amount: roundOff }] : []),
    ];
    // "Level Discount (Tier · synthetic%)" — the spend-tier row label. The % shown is
    // the synthetic share of the customer's tag (incl. GST), NOT the configured
    // % of cost (which stays on admin surfaces only). `tier.badgeLevelName`, not
    // snapshot.customerLevel — the snapshot's is the history-only badge and goes stale
    // the moment a CURRENT_SALE level is cleared.
    const posTierLabel = effDiscountAmount > 0.005
        ? `Level Discount${(() => {
            const parts = [tier.badgeLevelName, synthDiscountPct > 0 ? `${synthDiscountPct}%` : ""].filter(Boolean);
            return parts.length ? ` (${parts.join(" · ")})` : "";
        })()}`
        : undefined;

    async function applyGiftCard() {
        const code = giftCardCodeStr.trim();
        if (!code) return;
        setGcBusy(true);
        try {
            const { data } = await axios.post<{ ok: boolean; reason?: string; id: number; code: string; balance: number }>("/api/pos/gift-card-lookup", { code });
            if (data.ok) { setGiftCard({ id: data.id, code: data.code, balance: data.balance }); toast.success(`Gift card ${data.code} · ${formatInr(data.balance)} available`); }
            else { setGiftCard(null); toast.error(data.reason ?? "Gift card not usable"); }
        } catch {
            toast.error("Gift-card lookup failed");
        } finally {
            setGcBusy(false);
        }
    }

    // ── Coupon apply + auto-revalidation ──────────────────────────────────────
    // The server owns the ₹ value. We re-validate whenever the cart / tier /
    // loyalty inputs change so the stored amount never goes stale (checkout
    // re-validates too — the server is the final authority).
    const couponSig = useMemo(
        () => `${cart.map((l) => `${l.productId}:${l.qty}:${l.unitPrice}`).join("|")}#${discountAmount}#${redemptionRupees}`,
        [cart, discountAmount, redemptionRupees],
    );
    const appliedCode = appliedCoupon?.code ?? null;
    type ValidateResp = { ok: boolean; reason?: string; couponId: number; code: string | null; name: string; discountRupees: number; droppedTier: boolean; blockedLoyalty: boolean };
    async function runValidate(validateOpts: { code?: string; autoApply?: boolean }): Promise<ValidateResp | null> {
        if (!snapshot?.account) return null;
        const { data } = await axios.post<ValidateResp>("/api/pos/coupon-validate", {
            accountId: snapshot.account.id,
            code: validateOpts.code,
            autoApply: validateOpts.autoApply,
            isNewCustomer: snapshot.turnover.invoiceCount === 0,
            tierRupees: discountAmount,
            loyaltyRupees: redemptionRupees,
            // taxRate rides along so the server can gross up its resolved cost to
            // cost-incl-tax — the PERCENT-coupon base. Service lines are excluded —
            // coupons evaluate the goods cart only (mirrors /api/pos/sale).
            lines: cart.filter((l) => l.kind !== "service").map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate })),
        });
        return data;
    }
    const hit = (d: ValidateResp): CouponHit => ({ couponId: d.couponId, code: d.code, name: d.name, rupees: d.discountRupees, droppedTier: d.droppedTier, blockedLoyalty: d.blockedLoyalty });

    // Re-validate the applied manual coupon when the cart / tier / loyalty change.
    useEffect(() => {
        if (!appliedCode || !snapshot?.account) return;
        let cancelled = false;
        runValidate({ code: appliedCode })
            .then((data) => {
                if (cancelled || !data) return;
                if (data.ok) setAppliedCoupon((prev) => (prev ? { ...prev, rupees: data.discountRupees, droppedTier: data.droppedTier, blockedLoyalty: data.blockedLoyalty } : prev));
                else { setAppliedCoupon(null); toast.message("Coupon removed — no longer applies to this cart"); }
            })
            .catch(() => { /* keep prior value; checkout re-validates */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [couponSig, appliedCode, snapshot?.account?.id]);

    // Auto-apply: when there's no manual coupon, surface the best eligible AUTO
    // offer. The server re-applies it at checkout via the autoApply flag.
    useEffect(() => {
        if (appliedCode || !snapshot?.account || cart.length === 0) { setAutoCoupon(null); return; }
        let cancelled = false;
        runValidate({ autoApply: true })
            .then((data) => { if (!cancelled) setAutoCoupon(data?.ok ? hit(data) : null); })
            .catch(() => { if (!cancelled) setAutoCoupon(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [couponSig, appliedCode, snapshot?.account?.id, cart.length]);

    async function applyCoupon() {
        const code = couponCodeStr.trim().toUpperCase();
        if (!code || !snapshot?.account) return;
        setCouponBusy(true);
        try {
            const data = await runValidate({ code });
            if (data?.ok) {
                setAppliedCoupon(hit(data));
                toast.success(`Coupon ${data.code ?? data.name} applied · − ${formatInr(data.discountRupees)}`);
            } else {
                setAppliedCoupon(null);
                toast.error(data?.reason ?? "Coupon not applicable");
            }
        } catch {
            toast.error("Coupon check failed");
        } finally {
            setCouponBusy(false);
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    const fetchSnapshot = async (accountId: number) => {
        setLoadingSnapshot(true);
        // Once a party is picked the search is locked; shift focus to the product
        // search so the cashier can scan/type immediately.
        setTimeout(() => productSearchRef.current?.focus(), 50);
        try {
            const { data } = await axios.get<Snapshot>(`/api/pos/account-snapshot/${accountId}`);
            setSnapshot(data);
        } catch {
            toast.error("Could not load customer details");
            setSnapshot(null);
        } finally {
            setLoadingSnapshot(false);
        }
    };

    // Re-sync effective sale prices once, when a sale starts. A counter can sit
    // idle for hours; prices may have been re-frozen elsewhere meanwhile. This
    // hits the lightweight prices-only endpoint (no GST/cost cascade) and patches
    // the in-memory list by id — cart lines stay snapshotted, so it never shifts
    // a sale in progress. Failure is silent: keep the prices we already have.
    const refreshPrices = async () => {
        try {
            const { data } = await axios.get<
                Array<{ id: number; effectiveSalePricePaise: number | null; mrpPaise: number | null }>
            >("/api/inventory/products/prices");
            const byId = new Map(data.map((p) => [p.id, p]));
            setAllProducts((prev) =>
                prev.map((p) => {
                    const fresh = byId.get(p.id);
                    return fresh
                        ? { ...p, effectiveSalePricePaise: fresh.effectiveSalePricePaise, mrpPaise: fresh.mrpPaise }
                        : p;
                }),
            );
        } catch { /* keep current prices if the refresh fails */ }
    };

    const onPartyPicked = (p: PickedParty) => {
        // Manually choosing a customer means this is no longer the preloaded
        // repair-ticket bill — drop the ticket link so we don't mis-attribute it.
        setTicketId(null);
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        void refreshPrices();          // billing starts — pull prices re-frozen while idle
        void fetchSnapshot(p.accountId);
    };

    const clearCustomer = () => {
        setSnapshot(null);
        setTicketId(null);
        partySearchRef.current?.clear();
        partySearchRef.current?.focus();
    };

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = (p: ProductOption) => {
        // Product's effectiveSalePricePaise is treated as TAX-INCLUSIVE (matches
        // the price tag / MRP-style retail expectations). We back-calculate the
        // pre-tax rate here so the rest of the math (calcLineTotals) — which
        // expects an exclusive rate — produces the right breakdown.
        const inclusivePrice = p.effectiveSalePricePaise ? p.effectiveSalePricePaise / 100 : 0;
        const taxRate = p.taxRate ?? 0;
        const defaultPrice = taxRate > 0 ? inclusivePrice / (1 + taxRate / 100) : inclusivePrice;
        const warrantyLabel = p.warrantyTerm
            ? (p.warrantyTerm.durationDays
                ? (p.warrantyTerm.durationDays % 365 === 0
                    ? `${p.warrantyTerm.durationDays / 365}y`
                    : p.warrantyTerm.durationDays % 30 === 0
                        ? `${p.warrantyTerm.durationDays / 30}m`
                        : `${p.warrantyTerm.durationDays}d`)
                : p.warrantyTerm.name)
            : null;
        setCart((prev) => {
            const exist = prev.find((l) => l.productId === p.id);
            if (exist) return prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l);
            return [...prev, {
                productId: p.id, sku: p.sku, name: p.name,
                qty: 1, unitPrice: defaultPrice, description: "",
                taxRate: p.taxRate ?? 0,
                costPaise: p.costPaise ?? null,
                mrpPaise: p.mrpPaise ?? null,
                barcodePaise: p.barcodePricePaise ?? null,
                warrantyLabel,
                requireSaleNote: p.requireSaleNote ?? false,
                redeemCapPct: p.redeemCapPct ?? null,
            }];
        });
        setProductQuery("");
        // Clear highlight + return focus to the search box so cashier can scan next item
        setProductHighlight(0);
        setTimeout(() => productSearchRef.current?.focus(), 0);
    };

    // Add a POS service (Settings → POS Services) to the cart as a GL-only line
    // (kind="service"): its default price is TAX-INCLUSIVE, so back-calculate the
    // pre-tax rate exactly like a product. No barcode / cost / MRP / stock. The
    // line id is −serviceId so it never collides with a product id, and the same
    // productId-keyed qty/price setters work unchanged.
    const addServiceToCart = (svc: PosServiceOption) => {
        const inclusive = svc.defaultPricePaise ? svc.defaultPricePaise / 100 : 0;
        const rate = svc.taxRate ?? 0;
        const price = rate > 0 ? inclusive / (1 + rate / 100) : inclusive;
        const lineId = -svc.id;
        setCart((prev) => {
            const exist = prev.find((l) => l.productId === lineId);
            if (exist) return prev.map((l) => l.productId === lineId ? { ...l, qty: l.qty + 1 } : l);
            return [...prev, {
                productId: lineId, sku: "SVC", name: svc.name, kind: "service" as const,
                qty: 1, unitPrice: price, description: "",
                taxRate: rate,
            }];
        });
        setTimeout(() => productSearchRef.current?.focus(), 0);
    };

    const setQty = (productId: number, qty: number) => {
        if (qty <= 0) { setCart((p) => p.filter((l) => l.productId !== productId)); return; }
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, qty } : l));
    };

    const setPrice = (productId: number, unitPrice: number) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, unitPrice } : l));

    const setLineDescription = (productId: number, description: string) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, description } : l));

    // ── Product dropdown keyboard nav ──────────────────────────────────────
    const onProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (filteredProducts.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setProductHighlight((i) => Math.min(i + 1, filteredProducts.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setProductHighlight((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = filteredProducts[productHighlight] ?? filteredProducts[0];
            if (pick) addToCart(pick);
        } else if (e.key === "Escape") {
            setProductQuery("");
        }
    };

    const openCheckout = () => {
        if (!snapshot?.account) { toast.error("Pick a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        setPay({ cashTendered: 0, cashReturn: 0 });
        // Pre-show the accounts flagged "default visible" as rows; the rest stay
        // behind "Add payment line".
        setSplits(payAccounts.filter((a) => a.defaultVisible).map((a) => ({ id: crypto.randomUUID(), paymentAccountId: a.id, amount: 0, reference: "" })));
        setCheckoutOpen(true);
        setTimeout(() => cashTenderedRef.current?.focus(), 50);
    };

    // Post-submit reset — the identical clear-out block both screens ran after a
    // successful save.
    const resetAfterSubmit = () => {
        setCart([]);
        setPay({ cashTendered: 0, cashReturn: 0 });
        setSplits([]);
        setShippingAmtStr("");
        setRedeemPointsStr("");
        setRedeemOn(false);
        setCouponCodeStr("");
        setAppliedCoupon(null);
        setAutoCoupon(null);
        setGiftCardCodeStr("");
        setGiftCard(null);
        setRoundOffStr("");
        setRoundOffManuallyEdited(false);
        setCharges([]);
        setTicketId(null);
        setAdjustmentsOpen(false);
        setCheckoutOpen(false);
    };

    // Money math derived from pay — Cash net = tendered − return.
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const splitsSum = splits.reduce((s, x) => s + x.amount, 0);
    // Total entered against UPI-channel accounts — drives the customer-display QR.
    const upiEntered = splits.reduce(
        (s, x) => s + (payAccountById.get(x.paymentAccountId ?? -1)?.channel === "UPI" ? x.amount : 0),
        0,
    );
    // VPA of the UPI account the cashier is collecting into — the per-counter payee
    // for the DQ11 pay QR. First UPI split with a configured VPA wins (a counter
    // usually has one). Same per-counter source as the Share QR; no relay fallback.
    const upiVpa = splits
        .map((x) => payAccountById.get(x.paymentAccountId ?? -1))
        .find((a) => a?.channel === "UPI" && a.vpa)?.vpa ?? null;
    const collected = cashNet + splitsSum;
    const onCredit = Math.max(0, payableTotal - collected);
    const overpaid = Math.max(0, collected - payableTotal);
    const balanceDue = snapshot?.balanceDue ?? 0;
    const arrearPaid = Math.min(overpaid, balanceDue);
    const advanceTaken = Math.max(0, overpaid - balanceDue);

    // Customer-facing display coordinator (shared hook — the live QR/cart/customer
    // frames while a bill is built). The post-sale thank-you finale + printing stay
    // in each screen's submit routine; only this live coordinator is shared.
    usePosCustomerDisplay({
        displayHold, checkoutOpen, upiEntered, upiVpa, upiPayeeName: DEFAULT_PAYEE_NAME,
        cashNet, splitsSum, payableTotal, collected,
        cart, snapshot, subtotal, discountAmount, total, totalDiscount,
        effDiscountAmount, effRedemptionRupees, couponRupees, posExtraCharges, posTierLabel,
    });

    // Credit-limit guard — true when the on-credit portion of this sale would
    // push the customer's outstanding balance past their credit limit.
    const creditLimitBreached: boolean = (() => {
        if (onCredit <= 0) return false; // fully paid, no AR impact
        const limit = snapshot?.creditLimit ?? null;
        if (limit === null) return false; // unlimited account
        if (limit === 0) return true;  // zero-credit account
        return (balanceDue + onCredit) > limit;
    })();

    // True when any cart line flagged requireSaleNote still has a blank note.
    // Gates the Checkout button (disabled) — the cashier must capture the
    // serial / colour / config before selling such items.
    const saleNoteMissing = cart.some((l) => l.requireSaleNote && !l.description.trim());

    // Opened-at clock label for the header shift menu (mirrors ActiveShiftBar).
    const shiftOpenedAt = activeShift
        ? new Date(activeShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

    return {
        posAccess,
        // customer
        snapshot, setSnapshot, loadingSnapshot, setCreateDialogOpen,
        fetchSnapshot, onPartyPicked, clearCustomer,
        // product search + cart
        productQuery, setProductQuery, productHighlight, setProductHighlight,
        filteredProducts, cart, setCart, addToCart, setQty, setPrice, setLineDescription, onProductKeyDown,
        saleNoteMissing,
        // POS services (added from the "+ Add service charge" button, not the search)
        allServices, addServiceToCart,
        // checkout / tenders
        checkoutOpen, setCheckoutOpen, shareOpen, setShareOpen, shareVpa, setShareVpa,
        pay, setPay, splits, setSplits, submitting, setSubmitting, openCheckout,
        // adjustments / offers
        adjustmentsOpen, setAdjustmentsOpen, shippingAmt, shippingAmtStr, setShippingAmtStr,
        shippingGstRate, shippingTaxAmt,
        redeemPointsStr, setRedeemPointsStr, redeemOn, setRedeemOn,
        couponCodeStr, setCouponCodeStr, appliedCoupon, setAppliedCoupon, autoCoupon,
        couponBusy, applyCoupon,
        giftCard, setGiftCard, giftCardCodeStr, setGiftCardCodeStr, gcBusy, applyGiftCard,
        roundOff, autoRoundOff, roundOffStr, setRoundOffStr, roundOffManuallyEdited, setRoundOffManuallyEdited,
        charges, setCharges, resetDraft, resetAfterSubmit, ticketId,
        // shift
        activeShift, setActiveShift, pendingHandover, setPendingHandover, shiftLoaded,
        shiftOpenDialogOpen, setShiftOpenDialogOpen, returnDialogOpen, setReturnDialogOpen,
        expenditureDialogOpen, setExpenditureDialogOpen, receiptDialogOpen, setReceiptDialogOpen,
        shiftDropOpen, setShiftDropOpen, shiftCloseOpen, setShiftCloseOpen,
        refreshActiveShift, shiftOpenedAt,
        payAccounts, payAccountById,
        // bill math
        lineRows, subtotal, tax, discountPct, synthDiscountPct, discountAmount, totalDiscount,
        tier, currentSaleValue,
        rates, canRedeem, loyaltyBalance, redeemBlocked, maxRedeemablePts,
        effRedeemPts, effRedemptionRupees, effDiscountAmount, couponRupees,
        couponDroppedTier, couponBlockedLoyalty,
        total, giftCardApplied, payableTotal, posExtraCharges, posTierLabel,
        // tender math
        cashNet, splitsSum, upiEntered, collected, onCredit, overpaid, balanceDue,
        arrearPaid, advanceTaken, creditLimitBreached,
        // customer display
        displayHold, setDisplayHold,
    };
}

export type PosBilling = ReturnType<typeof usePosBilling>;
