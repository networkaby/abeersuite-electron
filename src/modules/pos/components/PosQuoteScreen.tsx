"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import {
    Search,
    ShoppingCart, Plus, Minus, Trash2,
    ReceiptIndianRupee,
} from "lucide-react";
import { type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { calcVoucherTotals, calcLineTotals } from "@/modules/inventory/lib/stock";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    type PartySearchAndCreateHandle,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";
import { ActiveShiftBar, type ActiveShift } from "@/modules/pos/components/ActiveShiftBar";
import { ShiftOpenDialog, type OpenedShift } from "@/modules/pos/components/ShiftOpenDialog";
import { HandoverAcceptDialog, type PendingHandover } from "@/modules/pos/components/HandoverAcceptDialog";
import { CashDropDialog } from "@/modules/pos/components/CashDropDialog";
import { ShiftCloseDialog } from "@/modules/pos/components/ShiftCloseDialog";
import { PosReturnDialog } from "@/modules/pos/components/PosReturnDialog";
import { PosExpenditureDialog } from "@/modules/pos/components/PosExpenditureDialog";
import { PosReceiptDialog } from "@/modules/pos/components/PosReceiptDialog";
import { type TenderSplit } from "@/modules/pos/components/TenderSplitInput";
import { CheckoutDialog } from "@/modules/pos/components/CheckoutDialog";
import { PaymentLinkDialog } from "@/modules/pos/components/PaymentLinkDialog";
import { PosTopBar } from "@/modules/pos/components/PosTopBar";
import { PosCustomerPanel } from "@/modules/pos/components/PosCustomerPanel";
import { PosBillSummary } from "@/modules/pos/components/PosBillSummary";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { extractApiError } from "@/shared/lib/api";
import { formatInr, parseDecimalInput, parseDigitsInput } from "@/shared/lib/format";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type Snapshot, type ProductOption } from "@/modules/pos/lib/posDraftTypes";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Text-input sanitisers — same shape as TradingVoucherPage's num/numSigned.
// Project rule: no <input type="number">; we keep raw strings in state and
// parse on submit / when computing totals.
function parseAmt(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

// ── Component ────────────────────────────────────────────────────────────────

// Order and Estimate are ONE screen with a few seams. Order takes an optional
// advance through the checkout dialog and LOCKS the full bill discount (its total
// must equal the Sale it becomes); Estimate is a non-binding quote that saves
// directly with the tier discount only — it never opens the checkout dialog.
// The protected Sale screen (/vouchers/pos/new, PosScreen.tsx) is deliberately
// NOT folded in here.
type QuoteMode = "order" | "estimate";
const QUOTE_CFG = {
    order: {
        header: "border-indigo-300 bg-indigo-100/70 dark:border-indigo-900 dark:bg-indigo-950/30",
        endpoint: "/api/pos/order",
        saveErr: "Failed to save order",
    },
    estimate: {
        header: "border-amber-300 bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/30",
        endpoint: "/api/pos/estimate",
        saveErr: "Failed to save estimate",
    },
} as const;

export default function PosQuoteScreen({ mode, editId }: { mode: QuoteMode; editId?: number }) {
    const cfg = QUOTE_CFG[mode];
    const router = useRouter();
    // Edit mode: reopen an existing order / estimate in this same screen, hydrate
    // its customer + lines, and PATCH on save instead of creating a new voucher.
    // Both go through the order endpoint — it accepts POS_ESTIMATE too (GL-silent).
    const isEdit = editId != null;
    // ── Customer search omnibox (delegated to shared component) ─────────────
    // snapshot + cart + bill adjustments live in the shared POS draft store so a
    // half-built Sale carries over when the cashier flips to Order / Estimate (see
    // posDraftStore.ts).
    const snapshot = usePosDraftStore((s) => s.snapshot);
    const setSnapshot = usePosDraftStore((s) => s.setSnapshot);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const partySearchRef = useRef<PartySearchAndCreateHandle>(null);

    // ── Product search + cart ───────────────────────────────────────────────
    const productSearchRef = useRef<HTMLInputElement>(null);
    const [productQuery, setProductQuery] = useState("");
    const [productHighlight, setProductHighlight] = useState(0);
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const cart = usePosDraftStore((s) => s.cart);
    const setCart = usePosDraftStore((s) => s.setCart);

    // ── Checkout / payment splits ───────────────────────────────────────────
    // Fixed three-row checkout: Cash (with a separate "return" sub-input),
    // UPI, and Credit (auto-balanced). No method dropdown, no UPI ref.
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [pay, setPay] = useState({ cashTendered: 0, cashReturn: 0 });
    const [splits, setSplits] = useState<TenderSplit[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const cashTenderedRef = useRef<HTMLInputElement>(null);
    // Share a UPI QR for the advance, exactly like POS Sale.
    const [shareOpen, setShareOpen] = useState(false);
    const [shareVpa, setShareVpa] = useState<string | null>(null);

    // ── Cart-level adjustments (shipping / round-off / charges) ────────────
    // Mirrors office SALE (TradingVoucherPage). Hidden behind a collapsible
    // panel above the Total row so the default cart screen stays clean.
    const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
    const shippingAmtStr = usePosDraftStore((s) => s.shippingAmtStr);
    const setShippingAmtStr = usePosDraftStore((s) => s.setShippingAmtStr);
    // Loyalty points the cashier is redeeming on this bill (whole-number string).
    const [redeemPointsStr, setRedeemPointsStr] = useState("");
    const [redeemOn, setRedeemOn] = useState(false); // tick to apply loyalty redemption
    // Coupon — code entry; the server validates + owns the ₹ value, returned here
    // so the displayed total matches what /api/pos/sale will post.
    const [couponCodeStr, setCouponCodeStr] = useState("");
    type CouponHit = { couponId: number; code: string | null; name: string; rupees: number; droppedTier: boolean; blockedLoyalty: boolean };
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
    // on a whole rupee. Flips to true the moment the cashier types into the
    // round-off field directly, so a manual override sticks.
    const roundOffManuallyEdited = usePosDraftStore((s) => s.roundOffManuallyEdited);
    const setRoundOffManuallyEdited = usePosDraftStore((s) => s.setRoundOffManuallyEdited);
    const charges = usePosDraftStore((s) => s.charges);
    const setCharges = usePosDraftStore((s) => s.setCharges);
    const resetDraft = usePosDraftStore((s) => s.reset);
    const [chargeAccounts, setChargeAccounts] = useState<GlAccount[]>([]);

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
    // Shift drop / close — launched from the header ⋮ menu now that the
    // full-width shift bar is hidden on the billing screen.
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

    // The counter's non-cash payment accounts, configured under
    // /office/admin/counters. Each advance split picks one; its accountId is the
    // ledger the advance Receipt is booked to. Cash routes to till (not listed).
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

    // Chart-of-accounts for the "+ Add charge" picker. Same filter as
    // TradingVoucherPage: exclude Cash-in-Hand and Bank Accounts (those are
    // tender ledgers — POS routes them via the counter map, not via charges).
    useEffect(() => {
        axios.get<GlAccount[]>("/api/accountancy/gl-accounts?includeParties=false")
            .then((r) => setChargeAccounts(
                r.data.filter((a) =>
                    a.group?.name !== ACCOUNT_GROUPS.CASH_IN_HAND &&
                    a.group?.name !== ACCOUNT_GROUPS.BANK_ACCOUNTS,
                ),
            ))
            .catch(() => setChargeAccounts([]));
    }, []);

    // Ctrl/Cmd+Enter from anywhere → open checkout dialog (skip when modals are already open)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (createDialogOpen || checkoutOpen) return;
            if (cart.length === 0 || !snapshot?.account) return;
            e.preventDefault();
            if (isEdit) void generateInvoice(false);               // Editing → PATCH (no checkout / print)
            else if (mode === "estimate") void generateInvoice(true);   // Estimate saves directly — no payment checkout
            else openCheckout();                                   // Order opens the dialog to (optionally) collect an advance
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
        // openCheckout closes over current state; safe to depend on the listed values
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const filteredProducts = useMemo(() => {
        const q = productQuery.trim().toLowerCase();
        if (!q) return [] as ProductOption[];
        return allProducts
            .filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
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
    const discountPct = snapshot?.discountPct ?? 0;
    const discountAmount = (subtotal * discountPct) / 100;
    const shippingAmt = Math.max(0, parseAmt(shippingAmtStr));
    const manualChargesNet = charges.reduce((s, c) => s + parseAmt(c.amount), 0);

    // ── Loyalty redemption (mirrors the server) ───────────────────────────────
    // Redemption rides a negative charge to the dedicated "Loyalty Points
    // Redeemed" ledger, so it folds into chargesNet here exactly as the server
    // folds it into calcVoucherTotals. We clamp to balance + bill caps client-
    // side so we only ever send the route a value it will accept (it rejects
    // out-of-range redemptions with a 422).
    const rates = snapshot?.loyaltyRates ?? null;
    // Redemption is live only while the programme AND its redeem gate are on.
    const canRedeem = !!rates?.enabled && !!rates?.redeemEnabled;
    const loyaltyBalance = snapshot?.loyaltyPoints ?? 0;
    const goodsValue = Math.max(0, subtotal - discountAmount);   // post-tier, pre-GST reducible base
    const minRedeemPts = rates?.minRedeemPoints ?? 0;
    // Pre-redemption bill — used to enforce the min-invoice-to-redeem floor.
    const billBeforeRedemption = calcVoucherTotals(lineRows, shippingAmt, discountAmount, 0, manualChargesNet).totalAmount;
    const redeemBlocked = rates?.minRedeemInvoiceValue != null && billBeforeRedemption < rates.minRedeemInvoiceValue;
    // Cart-aware redeem ceiling — Σ (line net × that item's redeem cap %), with the
    // global cap as the per-line default (null → 100%). Mirrors the server's
    // redeemableBaseForCart so the bill total + payment check always agree.
    const globalCapPct = rates?.maxRedeemPctOfBill ?? null;
    const cartGoods = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const maxRedeemableRupees = cartGoods <= 0 ? 0 : cart.reduce((acc, l) => {
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
    // Combined customer-facing discount (tier + loyalty redemption) — shown as a
    // single "Total discount" line under Subtotal; the chips below break it down.
    // ── Coupon (server-validated) ──────────────────────────────────────────────
    // A non-stackable coupon DROPS the tier discount + BLOCKS loyalty redemption;
    // the validate route already told us which, so mirror it in the bill so the
    // client total matches what /api/pos/sale will post.
    // Manual coupon wins; otherwise the best auto-apply offer (if any).
    const effectiveCoupon = appliedCoupon ?? autoCoupon;
    const couponRupees = effectiveCoupon?.rupees ?? 0;
    const couponDroppedTier = !!effectiveCoupon?.droppedTier;
    const couponBlockedLoyalty = !!effectiveCoupon?.blockedLoyalty;
    const effDiscountAmount = couponDroppedTier ? 0 : discountAmount;
    const effRedemptionRupees = couponBlockedLoyalty ? 0 : redemptionRupees;
    const effRedeemPts = couponBlockedLoyalty ? 0 : redeemPts;

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
    // "Level Discount (Tier Name)" — the spend-tier row label.
    const posTierLabel = effDiscountAmount > 0.005
        ? `Level Discount${snapshot?.customerLevel ? ` (${snapshot.customerLevel})` : discountPct ? ` (${discountPct}%)` : ""}`
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
    async function runValidate(opts: { code?: string; autoApply?: boolean }): Promise<ValidateResp | null> {
        if (!snapshot?.account) return null;
        const { data } = await axios.post<ValidateResp>("/api/pos/coupon-validate", {
            accountId: snapshot.account.id,
            code: opts.code,
            autoApply: opts.autoApply,
            isNewCustomer: snapshot.turnover.invoiceCount === 0,
            tierRupees: discountAmount,
            loyaltyRupees: redemptionRupees,
            lines: cart.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice })),
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
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        void refreshPrices();          // billing starts — pull prices re-frozen while idle
        void fetchSnapshot(p.accountId);
    };

    const clearCustomer = () => {
        setSnapshot(null);
        partySearchRef.current?.clear();
        partySearchRef.current?.focus();
    };

    // ── Edit mode: hydrate an existing order on mount ───────────────────────────
    // Reopen the order in this very screen — load its customer (so the tier discount
    // re-derives) and rebuild the cart from its lines. Only New / Under-Review orders
    // are editable; the GET reports that and we bounce out otherwise.
    useEffect(() => {
        if (!isEdit) return;
        resetDraft();
        let cancelled = false;
        (async () => {
            try {
                const { data } = await axios.get<{
                    accountId: number | null;
                    editable: boolean;
                    lines: { productId: number; sku: string; name: string; description: string | null; quantity: number; rate: number; taxRate: number; mrpPaise: number | null; savedSalePricePaise: number | null }[];
                }>(`/api/orders/inv/${editId}`);
                if (cancelled) return;
                if (!data.editable) {
                    toast.error("This order can't be edited at its current stage.");
                    router.push("/office/orders");
                    return;
                }
                if (data.accountId != null) await fetchSnapshot(data.accountId);
                if (cancelled) return;
                setCart(data.lines.map((l) => ({
                    productId: l.productId,
                    sku: l.sku,
                    name: l.name,
                    qty: l.quantity,
                    unitPrice: l.rate,
                    // The server embeds "sku — name · note"; keep only the cashier's note.
                    description: l.description?.split(" · ").slice(1).join(" · ") || "",
                    taxRate: l.taxRate,
                    mrpPaise: l.mrpPaise,
                    barcodePaise: l.savedSalePricePaise,
                })));
            } catch (e: unknown) {
                if (cancelled) return;
                toast.error(extractApiError(e, `Could not load the ${mode} to edit`));
                router.push(mode === "order" ? "/office/orders" : "/office/accountancy/vouchers-registers/estimates");
            }
        })();
        return () => { cancelled = true; resetDraft(); };
        // One-shot hydration keyed on the voucher id; the helpers it calls are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit, editId]);

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = (p: ProductOption) => {
        // Product's effectiveSalePricePaise is treated as TAX-INCLUSIVE (matches
        // the price tag / MRP-style retail expectations). We back-calculate the
        // pre-tax rate here so the rest of the math (calcLineTotals) — which
        // expects an exclusive rate — produces the right breakdown.
        // Cashier sees Subtotal ₹100 + Tax ₹18 = Total ₹118 for an 18% item
        // tagged at ₹118.
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
                mrpPaise: p.mrpPaise ?? null,
                barcodePaise: p.barcodePricePaise ?? null,
                warrantyLabel,
                redeemCapPct: p.redeemCapPct ?? null,
            }];
        });
        setProductQuery("");
        // Clear highlight + return focus to the search box so cashier can scan next item
        setProductHighlight(0);
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
        // Pre-show the accounts flagged "default visible" as advance rows.
        setSplits(payAccounts.filter((a) => a.defaultVisible).map((a) => ({ id: crypto.randomUUID(), paymentAccountId: a.id, amount: 0, reference: "" })));
        setCheckoutOpen(true);
        setTimeout(() => cashTenderedRef.current?.focus(), 50);
    };

    const generateInvoice = async (printAfter = false) => {
        if (!snapshot?.account) { toast.error("Select a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }

        // Edit mode → PATCH the existing order's lines + discount (server recomputes
        // exactly like creation). No checkout / advance / print on an edit.
        if (isEdit) {
            setSubmitting(true);
            try {
                await axios.patch(`/api/orders/inv/${editId}`, {
                    lines: cart.map((l) => ({
                        productId: l.productId,
                        description: l.description || null,
                        quantity: l.qty,
                        rate: l.unitPrice,
                        taxRate: l.taxRate,
                        mrpPaise: l.mrpPaise ?? null,
                        savedSalePricePaise: l.barcodePaise ?? null,
                    })),
                    // Order locks the full bill discount (tier + loyalty + coupon) + shipping
                    // + round-off; an estimate is a tag-price quote → tier discount only.
                    discountAmt: mode === "order" ? totalDiscount : discountAmount,
                    discountPct: discountAmount > 0 ? discountPct : 0,
                    shippingAmt: mode === "order" ? shippingAmt : 0,
                    roundOff: mode === "order" ? roundOff : 0,
                });
                toast.success(mode === "order" ? "Order updated" : "Estimate updated");
                router.push(mode === "order" ? "/office/orders" : "/office/accountancy/vouchers-registers/estimates");
            } catch (e: unknown) {
                toast.error(extractApiError(e, `Failed to update ${mode}`));
            } finally {
                setSubmitting(false);
            }
            return;
        }

        // Order = OPTIONAL advance. Build payment tenders from the checkout dialog
        // (may be empty → no receipt voucher), mirroring the POS sale tender shape.
        // Estimate never collects payment, so its tender list stays empty.
        type PayLine = { paymentAccountId: number | null; amount: number; reference?: string };
        const paymentsList: PayLine[] = [];
        if (mode === "order") {
            if (cashNet > 0) paymentsList.push({ paymentAccountId: null, amount: cashNet });
            for (const s of splits) {
                if (s.amount <= 0) continue;
                paymentsList.push({ paymentAccountId: s.paymentAccountId, amount: s.amount, reference: s.reference || undefined });
            }
        }
        const advance = paymentsList.reduce((s, p) => s + p.amount, 0);
        if (advance > total + 0.01) { toast.error("Advance can't exceed the order total"); return; }
        setSubmitting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const lines = cart.map((l) => ({
                productId: l.productId,
                description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
                quantity: l.qty,
                unitPrice: l.unitPrice,
                taxRate: l.taxRate,
                mrpPaise: l.mrpPaise ?? null,
                savedSalePricePaise: l.barcodePaise ?? null,
            }));
            const party = {
                accountId: snapshot.account.id,
                partyType: snapshot.party.kind === "company" ? "company" : "customer",
                partyId: snapshot.party.id,
                partyName: snapshot.party.name,
                partyPhone: snapshot.party.phone ?? null,
                date: today,
            } as const;
            // Order is LOCKED = its total must equal the POS sale it will become, so it
            // carries the FULL bill discount (tier + loyalty + coupon) + shipping +
            // round-off, riding the same calcVoucherTotals the sale uses (loyalty/coupon
            // are RECORDED here, redeemed at fulfilment — Phase 2 holds). Any advance is
            // posted as a SECOND Receipt voucher. Estimate is a non-binding quote: tier
            // discount only, no shipping/round-off/payment.
            const body = mode === "order"
                ? {
                    ...party,
                    discountAmt: totalDiscount,
                    discountPct: discountAmount > 0 ? discountPct : 0,
                    shippingAmt,
                    roundOff,
                    notes: `POS Order — tier ${discountPct}%`
                        + (effRedeemPts > 0 ? `, loyalty ${effRedeemPts}pts ₹${effRedemptionRupees.toFixed(2)}` : "")
                        + (appliedCoupon ? `, coupon ${appliedCoupon.code ?? appliedCoupon.name} ₹${couponRupees.toFixed(2)}` : "")
                        + (advance > 0 ? ` | Advance ${formatInr(advance)}` : ""),
                    lines,
                    payments: paymentsList,
                }
                : {
                    ...party,
                    discountAmt: discountAmount,
                    discountPct: discountAmount > 0 ? discountPct : 0,
                    notes: `POS Estimate (discount ${discountPct}%)`,
                    lines,
                };
            const { data } = await axios.post<{ voucherId: number; reference: string; dealId: number | null; receiptVoucherId?: number | null; receiptVoucherRef?: string | null }>(cfg.endpoint, body);
            if (mode === "order") {
                const advMsg = data.receiptVoucherRef ? ` · advance ${data.receiptVoucherRef} ${formatInr(advance)}` : "";
                toast.success(`Order ${data.reference} · ${formatInr(total)}${data.dealId ? " · lead captured" : ""}${advMsg}`);
            } else {
                toast.success(`Estimate ${data.reference} · ${formatInr(total)}${data.dealId ? " · lead captured" : ""}`);
            }
            void qrDisplay.idle();
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
            setAdjustmentsOpen(false);
            setCheckoutOpen(false);
            if (printAfter) {
                window.open(`/receipt/voucher/inv/${data.voucherId}`, "_blank", "noopener");
                // Advance receipt prints as a second slip (GL voucher source).
                if (data.receiptVoucherId) window.open(`/receipt/voucher/gl/${data.receiptVoucherId}`, "_blank", "noopener");
            }
        } catch (e: unknown) {
            toast.error(extractApiError(e, cfg.saveErr));
        } finally {
            setSubmitting(false);
        }
    };

    // Money math derived from pay — Cash net = tendered − return.
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const splitsSum = splits.reduce((s, x) => s + x.amount, 0);
    const upiEntered = splits.reduce(
        (s, x) => s + (payAccountById.get(x.paymentAccountId ?? -1)?.channel === "UPI" ? x.amount : 0),
        0,
    );
    const collected = cashNet + splitsSum;
    const onCredit = Math.max(0, payableTotal - collected);
    const overpaid = Math.max(0, collected - payableTotal);
    const balanceDue = snapshot?.balanceDue ?? 0;
    const arrearPaid = Math.min(overpaid, balanceDue);
    const advanceTaken = Math.max(0, overpaid - balanceDue);
    // Confirm is blocked only on UNDER-payment (a credit sale → /sale). Exact pay
    // is a normal sale; over-payment is collected as surplus (Receipt voucher).

    // ── QR display coordinator ──────────────────────────────────────────────
    // Single source of truth for what the customer-facing DQ11 shows. Priority:
    //   1. thank-you (held by displayHold after a successful sale)
    //   2. UPI QR — checkout open and UPI amount entered
    //   3. payment summary — checkout open with cash/extras entered
    //   4. cart — items in cart
    //   5. customer welcome — customer picked, cart empty
    //   6. idle slideshow — nothing else
    // Debounced — the DQ11 takes ~3s to transmit a frame at 921600 baud, so
    // rapid keystrokes (typing/clearing UPI amount) would queue stale frames.
    // Wait 250ms after the last state change before pushing.
    // Fire-and-forget; relay-down never blocks POS.
    useEffect(() => {
        if (displayHold === "thankyou") return;

        const timer = setTimeout(() => {
            if (checkoutOpen && upiEntered > 0) {
                void qrDisplay.upi({
                    amount: upiEntered,
                    caption: `Pay ₹${upiEntered.toFixed(2)} via UPI`,
                });
            } else if (checkoutOpen && (cashNet > 0 || splitsSum > 0)) {
                void qrDisplay.payment({
                    total: payableTotal,
                    cashPaid: cashNet,
                    balance: Math.max(0, payableTotal - collected),
                });
            } else if (cart.length > 0) {
                // Customer-facing price ladder — same computed view as the receipt.
                const lr = cart.map((l) => calcLineTotals({ quantity: l.qty, rate: l.unitPrice, discountPct: 0, discountAmt: 0, taxRate: l.taxRate }));
                const lad = computePriceLadder({
                    lines: cart.map((l, i) => ({
                        description: l.name,
                        qty:         l.qty,
                        mrpPaise:    l.mrpPaise,
                        barcodePaise: l.barcodePaise,
                        taxRatePct:  l.taxRate,
                        taxAmount:   lr[i].taxAmount,
                        amount:      lr[i].amount,
                    })),
                    tierDiscount:    effDiscountAmount,
                    loyaltyDiscount: effRedemptionRupees,
                    couponDiscount:  couponRupees,
                    extraCharges:    posExtraCharges,
                    total,
                }, { tier: posTierLabel });
                void qrDisplay.cart({
                    items: cart.map((l, i) => {
                        // Per-unit tag from the ladder so the MRP-fallback hides the
                        // real price on the display too. Relay multiplies by qty.
                        const ll = lad.lines[i];
                        return {
                            name:    l.name,
                            qty:     l.qty,
                            price:   l.unitPrice,
                            mrp:     ll?.mrp != null && l.qty ? ll.mrp / l.qty : undefined,
                            barcode: ll?.barcode != null && l.qty ? ll.barcode / l.qty : undefined,
                        };
                    }),
                    subtotal,
                    discount: totalDiscount,
                    total,
                    discounts: lad.discounts.map((d) => ({ label: d.label, amount: d.amount })),
                    charges:   lad.charges.map((c) => ({ label: c.label, amount: c.amount })),
                    gst:       lad.taxTotal > 0 ? lad.taxTotal : undefined,
                    savings:   lad.savingsTotal > 0 ? { amount: lad.savingsTotal, pct: lad.savingsPct } : undefined,
                });
            } else if (snapshot) {
                void qrDisplay.customer({
                    name: snapshot.party.name,
                    level: snapshot.customerLevel,
                    loyaltyPoints: snapshot.loyaltyPoints,
                    lastVisitAt: snapshot.lastVisitAt,
                    discountPct: snapshot.discountPct,
                    balanceDue: snapshot.balanceDue,
                });
            } else {
                void qrDisplay.idle();
            }
        }, 250);

        return () => clearTimeout(timer);
    }, [
        displayHold, checkoutOpen, cart, snapshot,
        cashNet, upiEntered, splitsSum, collected,
        subtotal, discountAmount, total,
        totalDiscount, effDiscountAmount, effRedemptionRupees, couponRupees,
    ]);

    // Credit-limit guard — true when the on-credit portion of this sale would
    // push the customer's outstanding balance past their credit limit.
    const creditLimitBreached: boolean = (() => {
        if (onCredit <= 0) return false; // fully paid, no AR impact
        const limit = snapshot?.creditLimit ?? null;
        if (limit === null) return false; // unlimited account
        if (limit === 0) return true;  // zero-credit account
        return (balanceDue + onCredit) > limit;
    })();

    // ── Render ──────────────────────────────────────────────────────────────

    // Opened-at clock label for the header shift menu (mirrors ActiveShiftBar).
    const shiftOpenedAt = activeShift
        ? new Date(activeShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

    return (
        <div className="flex h-full w-full flex-col">
            {/* Awaiting-handover keeps the dedicated bar — its billing-disabled
                messaging is safety-critical and must stay loud. A normal OPEN
                shift no longer shows a full-width strip; its status + actions
                live in the header ⋮ menu below, and the "no shift" state is
                surfaced by the amber menu trigger. */}
            {activeShift?.status === "AWAITING_HANDOVER" && (
                <ActiveShiftBar
                    shift={activeShift}
                    onClosed={() => { setActiveShift(null); refreshActiveShift(); }}
                    onHandoverCancelled={refreshActiveShift}
                />
            )}

            {/* ShiftOpenDialog — fresh start (no handover waiting) */}
            <ShiftOpenDialog
                open={shiftOpenDialogOpen}
                onOpenChange={setShiftOpenDialogOpen}
                onOpened={(_s: OpenedShift) => {
                    // Re-fetch via /api/pos/shifts/current so we get the full
                    // counter info including per-method payment mappings (the
                    // dialog's payload only carries id/name/tillAccount).
                    setShiftOpenDialogOpen(false);
                    refreshActiveShift();
                }}
            />

            {/* HandoverAcceptDialog — shown when B has a pending handover */}
            {pendingHandover && (
                <HandoverAcceptDialog
                    open={true}
                    handover={pendingHandover}
                    onAccepted={(shiftId, openingFloat) => {
                        setPendingHandover(null);
                        refreshActiveShift();
                        void shiftId;
                        void openingFloat;
                    }}
                    onDismiss={() => {
                        // User chose to log out instead.
                        window.location.href = "/api/auth/signout";
                    }}
                />
            )}

            {/* Top bar — customer search + actions (shared PosTopBar) */}
            <PosTopBar
                headerClass={cfg.header}
                active={mode}
                partySearchRef={partySearchRef}
                onPartyPicked={onPartyPicked}
                locked={!!snapshot}
                onDialogOpenChange={setCreateDialogOpen}
                showClear={!!snapshot}
                onClear={clearCustomer}
                onNewCustomer={() => partySearchRef.current?.openNew()}
                onReturn={() => setReturnDialogOpen(true)}
                onExp={() => activeShift ? setExpenditureDialogOpen(true) : toast.error("Open a shift first to record an expenditure")}
                onRcv={() => activeShift ? setReceiptDialogOpen(true) : toast.error("Open a shift first to collect a payment")}
                activeShift={activeShift}
                shiftLoaded={shiftLoaded}
                shiftOpenedAt={shiftOpenedAt}
                onRefreshShift={refreshActiveShift}
                onDropToSafe={() => setShiftDropOpen(true)}
                onCloseShift={() => setShiftCloseOpen(true)}
                onOpenShift={() => setShiftOpenDialogOpen(true)}
            />

            {/* Sale Return dialog */}
            <PosReturnDialog
                open={returnDialogOpen}
                onOpenChange={setReturnDialogOpen}
                onDone={() => { /* no cart refresh needed — return is a standalone action */ }}
            />

            {/* Counter expenditure dialog — needs an open shift (till to pay from) */}
            {activeShift && (
                <PosExpenditureDialog
                    open={expenditureDialogOpen}
                    onOpenChange={setExpenditureDialogOpen}
                    shiftId={activeShift.id}
                    counterName={activeShift.counter.tillAccount.name}
                    onDone={refreshActiveShift}
                />
            )}

            {/* Receipt dialog — collect a party payment into the counter till */}
            {activeShift && (
                <PosReceiptDialog
                    open={receiptDialogOpen}
                    onOpenChange={setReceiptDialogOpen}
                    shiftId={activeShift.id}
                    paymentAccounts={activeShift.counter.paymentAccounts}
                    onDone={refreshActiveShift}
                />
            )}

            {/* Shift drop / close — launched from the header ⋮ menu (OPEN shifts).
                Awaiting-handover uses ActiveShiftBar's own copies instead. */}
            {activeShift?.status === "OPEN" && (
                <>
                    <CashDropDialog
                        open={shiftDropOpen}
                        onOpenChange={setShiftDropOpen}
                        shiftId={activeShift.id}
                        onDropped={refreshActiveShift}
                    />
                    <ShiftCloseDialog
                        open={shiftCloseOpen}
                        onOpenChange={setShiftCloseOpen}
                        shiftId={activeShift.id}
                        onClosed={() => { setActiveShift(null); refreshActiveShift(); }}
                    />
                </>
            )}

            {/* Main grid */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                {/* Left column — product picker + cart */}
                <main className="flex min-h-0 flex-col border-r border-border">
                    <div className="shrink-0 border-b border-border p-4">
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                <Input
                                    ref={productSearchRef}
                                    value={productQuery}
                                    onChange={(e) => { setProductQuery(e.target.value); setProductHighlight(0); }}
                                    onKeyDown={onProductKeyDown}
                                    placeholder="Scan / type · ↑↓ to highlight · ↵ to add"
                                    className="h-11 rounded-lg pl-11 text-base shadow-sm focus-visible:ring-2"
                                />
                                {filteredProducts.length > 0 && (
                                    <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                        {filteredProducts.map((p, i) => (
                                            <li key={p.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => addToCart(p)}
                                                    onMouseEnter={() => setProductHighlight(i)}
                                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === productHighlight ? "bg-muted" : "hover:bg-muted"}`}
                                                >
                                                    <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                                                    <span className="flex-1 px-3 truncate">{p.name}</span>
                                                    <span className="text-xs text-muted-foreground">{p.effectiveSalePricePaise ? `₹${(p.effectiveSalePricePaise / 100).toLocaleString("en-IN")}` : "—"}</span>
                                                    <Plus size={14} className="ml-2 text-muted-foreground" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {/* Cart count — relocated off its own strip onto the search row to save a row */}
                            <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground">
                                <ShoppingCart size={16} /> Cart ({cart.length})
                            </div>
                        </div>
                    </div>

                    {/* Cart */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex-1 overflow-y-auto">
                            {cart.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                                    <div className="rounded-full bg-muted p-3 text-muted-foreground">
                                        <ShoppingCart size={24} className="opacity-70" />
                                    </div>
                                    <p className="text-sm font-medium text-foreground/80">Cart is empty</p>
                                    <p className="text-xs text-muted-foreground">Scan a barcode or search above to add items.</p>
                                </div>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {cart.map((l) => {
                                        // Enter on any cart-line input → refocus the product search so the
                                        // cashier can scan the next item without reaching for the mouse.
                                        const enterToNextProduct = (e: React.KeyboardEvent) => {
                                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); productSearchRef.current?.focus(); }
                                        };
                                        const mrp = l.mrpPaise ? l.mrpPaise / 100 : null;
                                        // Printed barcode/tag price (read-only). Shown so the cashier
                                        // sees the same figure the customer's print/display shows, and
                                        // can spot products missing barcode/MRP data at a glance.
                                        const barcode = l.barcodePaise ? l.barcodePaise / 100 : null;
                                        return (
                                            <li key={l.productId} className="px-4 py-2.5">
                                                {/* Wide layout: name | warranty | note | mrp | qty | price | trash all on one line.
                                                    Narrow (<lg) stacks name above and the rest below. */}
                                                <div className="grid items-center gap-2 lg:grid-cols-[minmax(180px,1.4fr)_70px_minmax(160px,1fr)_130px_auto_110px_auto]">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-medium">{l.name}</div>
                                                        <div className="font-mono text-[10px] text-muted-foreground">{l.sku}</div>
                                                    </div>
                                                    <div className="hidden lg:flex justify-center">
                                                        {l.warrantyLabel ? (
                                                            <Badge variant="secondary" className="text-[10px]">⛨ {l.warrantyLabel}</Badge>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground/60">—</span>
                                                        )}
                                                    </div>
                                                    <Input
                                                        value={l.description}
                                                        onChange={(e) => setLineDescription(l.productId, e.target.value)}
                                                        onKeyDown={enterToNextProduct}
                                                        placeholder="Note — colour, config…"
                                                        className="h-8 text-sm"
                                                    />
                                                    <div className="hidden lg:flex flex-col items-end gap-0.5 text-[10px] leading-tight text-muted-foreground">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="uppercase tracking-wider">MRP</span>
                                                            <span className={mrp != null && mrp !== l.unitPrice ? "line-through" : ""}>{mrp != null ? formatInr(mrp) : "—"}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="uppercase tracking-wider">Barcode</span>
                                                            <span>{barcode != null ? formatInr(barcode) : "—"}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty - 1)}><Minus size={12} /></Button>
                                                        <Input
                                                            value={l.qty}
                                                            onChange={(e) => setQty(l.productId, Number(e.target.value) || 0)}
                                                            onKeyDown={enterToNextProduct}
                                                            className="h-8 w-12 text-center"
                                                            inputMode="decimal"
                                                        />
                                                        <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, l.qty + 1)}><Plus size={12} /></Button>
                                                    </div>
                                                    {/* Price column shows the TAX-INCLUSIVE price (matches the
                                                        price tag). Storage stays pre-tax — we back-calculate on
                                                        every edit so calcLineTotals keeps receiving an exclusive
                                                        rate. For tax-free items (taxRate=0) the two values match. */}
                                                    <PriceInput
                                                        inclusive={l.unitPrice * (1 + (l.taxRate ?? 0) / 100)}
                                                        onCommit={(inc) => setPrice(l.productId, inc / (1 + (l.taxRate ?? 0) / 100))}
                                                        onKeyDown={enterToNextProduct}
                                                    />
                                                    <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.productId, 0)} title="Remove">
                                                        <Trash2 size={12} className="text-destructive" />
                                                    </Button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Totals + checkout — shared PosBillSummary. Checkout button is
                            injected per mode (Order collects an optional advance; Estimate
                            saves directly). */}
                        <PosBillSummary
                            subtotal={subtotal}
                            tax={tax}
                            total={total}
                            totalDiscount={totalDiscount}
                            discountPct={discountPct}
                            discountAmount={discountAmount}
                            snapshot={snapshot}
                            rates={rates}
                            canRedeem={canRedeem}
                            loyaltyBalance={loyaltyBalance}
                            redeemBlocked={redeemBlocked}
                            maxRedeemablePts={maxRedeemablePts}
                            redeemOn={redeemOn}
                            setRedeemOn={setRedeemOn}
                            redeemPointsStr={redeemPointsStr}
                            setRedeemPointsStr={setRedeemPointsStr}
                            effRedemptionRupees={effRedemptionRupees}
                            appliedCoupon={appliedCoupon}
                            setAppliedCoupon={setAppliedCoupon}
                            autoCoupon={autoCoupon}
                            couponRupees={couponRupees}
                            couponDroppedTier={couponDroppedTier}
                            couponBlockedLoyalty={couponBlockedLoyalty}
                            couponCodeStr={couponCodeStr}
                            setCouponCodeStr={setCouponCodeStr}
                            applyCoupon={applyCoupon}
                            couponBusy={couponBusy}
                            giftCard={giftCard}
                            setGiftCard={setGiftCard}
                            giftCardCodeStr={giftCardCodeStr}
                            setGiftCardCodeStr={setGiftCardCodeStr}
                            applyGiftCard={applyGiftCard}
                            gcBusy={gcBusy}
                            giftCardApplied={giftCardApplied}
                            payableTotal={payableTotal}
                            adjustmentsOpen={adjustmentsOpen}
                            setAdjustmentsOpen={setAdjustmentsOpen}
                            shippingAmt={shippingAmt}
                            shippingAmtStr={shippingAmtStr}
                            setShippingAmtStr={setShippingAmtStr}
                            roundOff={roundOff}
                            autoRoundOff={autoRoundOff}
                            roundOffStr={roundOffStr}
                            setRoundOffStr={setRoundOffStr}
                            roundOffManuallyEdited={roundOffManuallyEdited}
                            setRoundOffManuallyEdited={setRoundOffManuallyEdited}
                            charges={charges}
                            setCharges={setCharges}
                            chargeAccounts={chargeAccounts}
                            cart={cart}
                            checkoutSlot={
                                <Button onClick={isEdit ? () => void generateInvoice(false) : (mode === "estimate" ? () => void generateInvoice(true) : openCheckout)} disabled={cart.length === 0 || !snapshot?.account || submitting} className="h-12 w-full text-base" size="lg">
                                    <ReceiptIndianRupee size={18} /> {isEdit ? "Update Order" : (mode === "estimate" ? "Save Estimate" : "Save Order")}
                                    <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                                </Button>
                            }
                        />
                    </div>
                </main>

                {/* Right column — customer "we know you" panel (shared) */}
                <PosCustomerPanel snapshot={snapshot} loading={loadingSnapshot} />
            </div>

            {/* ── Checkout dialog — fixed Cash / UPI / Credit rows ──────────────── */}
            {/* Order advance — the same checkout body as POS Sale, in "order" mode
                (advance optional, no credit-limit block, "Save Order" CTAs). */}
            <CheckoutDialog
                mode="order"
                open={checkoutOpen}
                onOpenChange={setCheckoutOpen}
                total={total}
                collected={collected}
                onCredit={onCredit}
                payableTotal={payableTotal}
                overpaid={overpaid}
                balanceDue={balanceDue}
                arrearPaid={arrearPaid}
                advanceTaken={advanceTaken}
                giftCardApplied={giftCardApplied}
                giftCardCode={giftCard?.code}
                creditLimitBreached={creditLimitBreached}
                creditLimit={snapshot?.creditLimit ?? null}
                pay={pay}
                setPay={setPay}
                cashTenderedRef={cashTenderedRef}
                accounts={payAccounts}
                splits={splits}
                setSplits={setSplits}
                submitting={submitting}
                onConfirm={generateInvoice}
                onShare={(a) => { setShareVpa(a.vpa); setShareOpen(true); }}
            />

            {/* Share a UPI QR with the customer to collect the advance remotely. */}
            <PaymentLinkDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                defaultAmount={onCredit > 0.01 ? onCredit : total}
                partyName={snapshot?.party.name}
                partyPhone={snapshot?.party.phone ?? null}
                upiVpa={shareVpa}
                lockedProviderId="upi"
            />

        </div>
    );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, muted, highlight, title }: { label: string; value: string; muted?: boolean; highlight?: boolean; title?: string }) {
    return (
        <div className={`flex items-center justify-between text-sm ${muted ? "text-muted-foreground" : ""} ${highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
            <span className={title ? "cursor-help underline decoration-dotted underline-offset-2" : ""} title={title}>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

// Tax-inclusive price cell. Holds a local DRAFT string so the cashier can type
// freely (e.g. clear it, type "1", "15", "150.5") without the controlled value
// snapping back to `toFixed(2)` on every keystroke. It commits the parsed amount
// up on each change, but only re-syncs the formatted display from `inclusive`
// when the field is NOT focused (external change / blur) — so typing is never
// fought. Input stays type=text (digits + one dot sanitized) per the repo rule.
function PriceInput({
    inclusive,
    onCommit,
    onKeyDown,
}: {
    inclusive: number;
    onCommit: (inclusive: number) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
    const fmt = (n: number) => (n ? n.toFixed(2) : "");
    const [draft, setDraft] = useState(() => fmt(inclusive));
    const [prevInclusive, setPrevInclusive] = useState(inclusive);
    const [focused, setFocused] = useState(false);

    // Keep the display in sync with external changes (qty/price reset, new line)
    // but never while the cashier is mid-edit. Adjusting state during render (vs.
    // an effect) avoids the extra commit/cascading render and the set-state-in-effect rule.
    if (inclusive !== prevInclusive) {
        setPrevInclusive(inclusive);
        if (!focused) setDraft(fmt(inclusive));
    }

    return (
        <Input
            value={draft}
            inputMode="decimal"
            placeholder="₹ price"
            className="h-8 text-right"
            onFocus={() => { setFocused(true); }}
            onBlur={() => { setFocused(false); setDraft(fmt(inclusive)); }}
            onKeyDown={onKeyDown}
            onChange={(e) => {
                // Allow digits + a single decimal point only.
                let raw = e.target.value.replace(/[^\d.]/g, "");
                const dot = raw.indexOf(".");
                if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "");
                setDraft(raw);
                onCommit(parseFloat(raw) || 0);
            }}
        />
    );
}
