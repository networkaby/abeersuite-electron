"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import Link from "next/link";
import {
    Search, X, User, Phone, Mail, Award, TrendingUp, Clock,
    ShoppingCart, Plus, Minus, Trash2, ArrowLeft, ExternalLink,
    Banknote, Wallet, CreditCard, Smartphone, Building2, FileText, UserPlus,
    MapPin, Star, Sparkles, AlertCircle, TrendingDown, Tag,
    ReceiptIndianRupee, Check, RotateCcw, ChevronDown, ChevronRight, HelpCircle, HandCoins,
    RefreshCw, Lock, ArrowRightLeft, Monitor, MoreVertical,
} from "lucide-react";
import { GlAccountCombobox, type GlAccount } from "@/modules/accountancy/components/GlAccountCombobox";
import { calcVoucherTotals, calcLineTotals } from "@/modules/inventory/lib/stock";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    PartySearchAndCreate,
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
import { PosModeSwitch } from "@/modules/pos/components/PosModeSwitch";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { computePriceLadder } from "@/modules/pos/lib/priceLadder";
import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";

// ── Types ────────────────────────────────────────────────────────────────────

type Snapshot = {
    party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null };
    account: { id: number; balance: number; openingBalance: number | null } | null;
    turnover: { lifetime: number; last12Months: number; invoiceCount: number };
    discountPct: number;
    loyaltyPoints: number;
    loyaltyRates: {
        enabled: boolean;
        earnEnabled: boolean;
        redeemEnabled: boolean;
        globalEarnRatePer: number;
        redeemValue: number;
        expiryEnabled: boolean;
        expiryDays: number;
        minEarnInvoiceValue: number | null;
        minRedeemInvoiceValue: number | null;
        minRedeemPoints: number | null;
        maxRedeemPctOfBill: number | null;
    } | null;
    customerLevel: string; // admin-defined spend-tier name ("" when no tier reached)
    creditLimit: number | null;    // deny-by-default: 0 = no credit, >0 = cap (server maps legacy NULL→0)
    balanceDue: number;
    balanceOverdue: number;
    availableCredit: number | null; // = max(0, creditLimit − balanceDue)
    rating: number | null;
    favouriteCategory: string | null;
    personalizedOffers: Array<{ id: string; label: string; tag: string }>;
    lastVisitAt: string | null;
    recentTickets: Array<{ id: number; createdAt: string; statusLabel: string; statusColor: string }>;
    warrantiesEnding: Array<{ productName: string; endsAt: string }>;
};

type ProductOption = {
    id: number; sku: string; name: string;
    /// Materialized effective sale price (paise) — the value POS charges.
    /// Read straight from the products/lookup response (column of the same name).
    effectiveSalePricePaise?: number | null;
    mrpPaise?: number | null;
    /// Printed barcode TAG price (paise) — DERIVED server-side from the saved
    /// sale price + MRP via the same band function the "Update & Print Labels"
    /// page uses, so the shelf tag == the receipt tag. Snapshotted onto the cart
    /// line as the public price for the customer "Counter discount" ladder
    /// (tag → effective). Falls back to the charged amount when absent.
    barcodePricePaise?: number | null;
    /// Effective GST rate resolved by the cascade product → group → org-default.
    /// Null = no rate found anywhere in the chain (line stays untaxed).
    taxRate?: number | null;
    hsnCode?: string | null;
    /// Loyalty redeem-cap override (% of this item's value redeemable with points).
    /// null = inherit the global cap. Snapshotted onto the cart line at add time.
    redeemCapPct?: number | null;
    unit?: { code: string };
    warrantyTerm?: { name: string; durationDays: number | null } | null;
};
type CartLine = {
    productId: number; sku: string; name: string;
    qty: number; unitPrice: number; description: string;
    /// Snapshotted at add-to-cart time so changing a product's GST later
    /// doesn't retroactively shift prices in an active sale.
    taxRate: number;
    mrpPaise?: number | null;
    /// Barcode / printed tag price (paise) snapshotted at add-to-cart time — feeds
    /// the customer-facing price ladder (barcode line + "price benefit").
    barcodePaise?: number | null;
    warrantyLabel?: string | null;
    /// Loyalty redeem-cap override (% redeemable with points; null = global cap).
    /// Snapshotted so the redeem ceiling matches the server's at checkout.
    redeemCapPct?: number | null;
};

// Extras = Card / Cheque / Bank Transfer / Wallet (Cash / UPI / Credit are fixed rows)
type ExtraMethod = "CARD" | "CHEQUE" | "BANK_TRANSFER" | "WALLET";
type ExtraSplit = { id: string; method: ExtraMethod; amount: number; reference: string };

const EXTRA_METHODS: { value: ExtraMethod; label: string; icon: React.ReactNode }[] = [
    { value: "CARD", label: "Card", icon: <CreditCard size={14} /> },
    { value: "CHEQUE", label: "Cheque", icon: <FileText size={14} /> },
    { value: "BANK_TRANSFER", label: "Bank transfer", icon: <Building2 size={14} /> },
    { value: "WALLET", label: "Wallet", icon: <Wallet size={14} /> },
];


// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Text-input sanitisers — same shape as TradingVoucherPage's num/numSigned.
// Project rule: no <input type="number">; we keep raw strings in state and
// parse on submit / when computing totals.
function numUnsigned(s: string): string {
    return s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}
function numSignedStr(s: string): string {
    const sign = s.trimStart().startsWith("-") ? "-" : "";
    return sign + numUnsigned(s);
}
function parseAmt(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}
// Whole-number sanitiser for the loyalty redeem-points input (no decimals).
function digitsInt(s: string): string {
    return s.replace(/[^\d]/g, "");
}

type ChargeRow = { id: string; accountId: number | null; description: string; amount: string };
const newChargeRow = (): ChargeRow => ({
    id: Math.random().toString(36).slice(2, 10),
    accountId: null,
    description: "",
    amount: "",
});

const since = (iso: string | null) => {
    if (!iso) return "never";
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
};

// ── Component ────────────────────────────────────────────────────────────────

export default function PosOrderScreen() {
    // ── Customer search omnibox (delegated to shared component) ─────────────
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const partySearchRef = useRef<PartySearchAndCreateHandle>(null);

    // ── Product search + cart ───────────────────────────────────────────────
    const productSearchRef = useRef<HTMLInputElement>(null);
    const [productQuery, setProductQuery] = useState("");
    const [productHighlight, setProductHighlight] = useState(0);
    const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);

    // ── Checkout / payment splits ───────────────────────────────────────────
    // Fixed three-row checkout: Cash (with a separate "return" sub-input),
    // UPI, and Credit (auto-balanced). No method dropdown, no UPI ref.
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [pay, setPay] = useState({ cashTendered: 0, cashReturn: 0, upi: 0 });
    const [extras, setExtras] = useState<ExtraSplit[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const cashTenderedRef = useRef<HTMLInputElement>(null);
    const upiAmountRef = useRef<HTMLInputElement>(null);

    // ── Cart-level adjustments (shipping / round-off / charges) ────────────
    // Mirrors office SALE (TradingVoucherPage). Hidden behind a collapsible
    // panel above the Total row so the default cart screen stays clean.
    const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
    const [shippingAmtStr, setShippingAmtStr] = useState("");
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
    const [roundOffStr, setRoundOffStr] = useState("");
    // Vyapar-style auto round-off: POS auto-derives the round-off to land Total
    // on a whole rupee. Flips to true the moment the cashier types into the
    // round-off field directly, so a manual override sticks.
    const [roundOffManuallyEdited, setRoundOffManuallyEdited] = useState(false);
    const [charges, setCharges] = useState<ChargeRow[]>([]);
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

    // Accepted non-cash methods are derived from the active shift's counter
    // (each counter wires UPI / Card / Wallet / Cheque / Bank Transfer to a
    // specific ledger under /office/admin/counters). Null mapping = method
    // not accepted at this counter → hidden in checkout. Cash is always
    // accepted (routes to till).
    const counterMethods = useMemo(() => {
        const c = activeShift?.counter;
        return {
            upi: c?.upiAccount ?? null,
            card: c?.cardAccount ?? null,
            wallet: c?.walletAccount ?? null,
            cheque: c?.chequeAccount ?? null,
            bankTransfer: c?.bankTransferAccount ?? null,
        };
    }, [activeShift]);
    // Counter-supplied custom labels — "PhonePe", "HDFC POS Terminal", etc.
    // Falls back to the built-in label in EXTRA_METHODS / the UPI fixed row.
    const upiLabel = activeShift?.counter.upiLabel?.trim() || "UPI";
    // Build the extras list with per-method label overrides applied so the
    // cashier sees the operator's wording in the picker.
    const allowedExtras = useMemo(() => EXTRA_METHODS
        .filter((m) => {
            if (m.value === "CARD") return counterMethods.card != null;
            if (m.value === "WALLET") return counterMethods.wallet != null;
            if (m.value === "CHEQUE") return counterMethods.cheque != null;
            if (m.value === "BANK_TRANSFER") return counterMethods.bankTransfer != null;
            return false;
        })
        .map((m) => {
            const c = activeShift?.counter;
            const override =
                m.value === "CARD" ? c?.cardLabel :
                    m.value === "WALLET" ? c?.walletLabel :
                        m.value === "CHEQUE" ? c?.chequeLabel :
                            m.value === "BANK_TRANSFER" ? c?.bankTransferLabel : null;
            const trimmed = override?.trim();
            return trimmed ? { ...m, label: trimmed } : m;
        }), [counterMethods, activeShift]);

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
            openCheckout();   // Order opens the dialog to (optionally) collect an advance
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
    const requestedPts = canRedeem && redeemOn && !redeemBlocked ? parseInt(digitsInt(redeemPointsStr) || "0", 10) : 0;
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
            if (data.ok) { setGiftCard({ id: data.id, code: data.code, balance: data.balance }); toast.success(`Gift card ${data.code} · ${fmtINR(data.balance)} available`); }
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
                toast.success(`Coupon ${data.code ?? data.name} applied · − ${fmtINR(data.discountRupees)}`);
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
        setPay({ cashTendered: 0, cashReturn: 0, upi: 0 });
        setExtras([]);
        setCheckoutOpen(true);
        setTimeout(() => cashTenderedRef.current?.focus(), 50);
    };

    const generateInvoice = async (printAfter = false) => {
        if (!snapshot?.account) { toast.error("Select a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        // Order = OPTIONAL advance. Build payment tenders from the dialog (may be
        // empty → no receipt voucher). Mirrors the POS sale tender shape.
        type PayLine = { method: "CASH" | "MOBILE_PAYMENT" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER"; amount: number; reference?: string };
        const paymentsList: PayLine[] = [];
        if (cashNet > 0) paymentsList.push({ method: "CASH", amount: cashNet });
        if (pay.upi > 0) paymentsList.push({ method: "MOBILE_PAYMENT", amount: pay.upi });
        for (const e of extras) {
            if (e.amount <= 0) continue;
            const method = e.method === "WALLET" ? "OTHER" : e.method;
            paymentsList.push({ method, amount: e.amount, reference: e.reference || undefined });
        }
        const advance = paymentsList.reduce((s, p) => s + p.amount, 0);
        if (advance > total + 0.01) { toast.error("Advance can't exceed the order total"); return; }
        setSubmitting(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            // POS Order — counter order (deliver-later / book-and-collect). No GL,
            // no stock (reservation is Phase 2/3); captures a CRM Deal. Any advance
            // is posted as a SECOND voucher (Receipt) on the customer's account.
            const { data } = await axios.post<{ voucherId: number; reference: string; dealId: number | null; receiptVoucherId: number | null; receiptVoucherRef: string | null }>("/api/pos/order", {
                accountId: snapshot.account.id,
                partyType: snapshot.party.kind === "company" ? "company" : "customer",
                partyId: snapshot.party.id,
                partyName: snapshot.party.name,
                partyPhone: snapshot.party.phone ?? null,
                date: today,
                // Order is LOCKED = its total must equal the POS sale it will become,
                // so we send the FULL bill discount (tier + loyalty + coupon) plus
                // shipping + round-off. These ride the same calcVoucherTotals the sale
                // uses, so server total === the cashier's screen total. (Loyalty/coupon
                // are RECORDED here and actually redeemed at fulfilment — Phase 2 holds.)
                discountAmt: totalDiscount,
                discountPct: discountAmount > 0 ? discountPct : 0,
                shippingAmt,
                roundOff,
                notes: `POS Order — tier ${discountPct}%`
                    + (effRedeemPts > 0 ? `, loyalty ${effRedeemPts}pts ₹${effRedemptionRupees.toFixed(2)}` : "")
                    + (appliedCoupon ? `, coupon ${appliedCoupon.code ?? appliedCoupon.name} ₹${couponRupees.toFixed(2)}` : "")
                    + (advance > 0 ? ` | Advance ${fmtINR(advance)}` : ""),
                lines: cart.map((l) => ({
                    productId: l.productId,
                    description: `${l.sku} — ${l.name}${l.description ? ` · ${l.description}` : ""}`,
                    quantity: l.qty,
                    unitPrice: l.unitPrice,
                    taxRate: l.taxRate,
                    mrpPaise: l.mrpPaise ?? null,
                    savedSalePricePaise: l.barcodePaise ?? null,
                })),
                payments: paymentsList,   // optional advance → server posts a Receipt voucher
            });
            const advMsg = data.receiptVoucherRef ? ` · advance ${data.receiptVoucherRef} ${fmtINR(advance)}` : "";
            toast.success(`Order ${data.reference} · ${fmtINR(total)}${data.dealId ? " · lead captured" : ""}${advMsg}`);
            void qrDisplay.idle();
            setCart([]);
            setPay({ cashTendered: 0, cashReturn: 0, upi: 0 });
            setExtras([]);
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
            const msg = axios.isAxiosError(e) ? (e.response?.data as { error?: string })?.error : undefined;
            toast.error(msg ?? "Failed to save order");
        } finally {
            setSubmitting(false);
        }
    };

    // Money math derived from pay — Cash net = tendered − return.
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const extrasSum = extras.reduce((s, e) => s + e.amount, 0);
    const collected = cashNet + pay.upi + extrasSum;
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
            if (checkoutOpen && pay.upi > 0) {
                void qrDisplay.upi({
                    amount: pay.upi,
                    caption: `Pay ₹${pay.upi.toFixed(2)} via UPI`,
                });
            } else if (checkoutOpen && (cashNet > 0 || extrasSum > 0)) {
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
        cashNet, pay.upi, extrasSum, collected,
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

            {/* Top bar — customer search */}
            <header className="flex shrink-0 items-center gap-3 border-b-2 border-indigo-300 bg-indigo-100/70 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                <Link href="/office" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" title="Back to office">
                    <ArrowLeft size={16} />
                </Link>
                <PosModeSwitch active="order" />
                <div className="flex-1 max-w-2xl">
                    <PartySearchAndCreate
                        ref={partySearchRef}
                        onPicked={onPartyPicked}
                        locked={!!snapshot}
                        onDialogOpenChange={setCreateDialogOpen}
                        // POS is strictly customer-facing. The walk-in fall-back
                        // ("Walk-in Cash Customer" ledger) handles the empty-party
                        // case at checkout; here we only show / create debtors.
                        partyGroup="Sundry Debtors"
                    />
                </div>
                {snapshot && (
                    <Button variant="ghost" size="sm" onClick={clearCustomer} className="text-muted-foreground">
                        <X size={14} /> Clear
                    </Button>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => partySearchRef.current?.openNew()}
                    title="Walk-in customer not in the system yet — create on the fly"
                >
                    <UserPlus size={14} /> New customer
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/vouchers/pos", "_blank", "noopener")}
                    title="Open another POS in a new tab — start a parallel bill while this one waits"
                >
                    <ExternalLink size={14} /> New tab
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReturnDialogOpen(true)}
                    title="Process a sale return — by invoice number, customer, or lost invoice"
                >
                    <RotateCcw size={14} /> Return
                </Button>
                {/* Exp — opens an expenditure voucher (payment-voucher variant) that
                    only permits payment to the counter's configured account
                    (office/admin/counters). UI only for now — handler is a placeholder. */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activeShift ? setExpenditureDialogOpen(true) : toast.error("Open a shift first to record an expenditure")}
                    title="Record a counter expenditure (tea, sundry donation…) — posts a payment voucher from the counter's till"
                >
                    <Banknote size={14} /> Exp
                </Button>
                {/* Rcv — collect a cash payment from a party into the counter till */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activeShift ? setReceiptDialogOpen(true) : toast.error("Open a shift first to collect a payment")}
                    title="Collect a payment from a customer into this counter's till — posts a receipt voucher"
                >
                    <HandCoins size={14} /> Rcv
                </Button>
                {/* Help — UI only for now. */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toast.info("POS help — coming soon")}
                    title="POS help & keyboard shortcuts"
                >
                    <HelpCircle size={14} /> Help
                </Button>

                {/* Shift status + actions — folds the old full-width shift bar into
                    the header. Also carries the nav link to the /vouchers/pos register
                    where the live shift overview lives. */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            title="Shift status & actions"
                            className={activeShift ? "border-emerald-300/70" : "border-amber-300/70"}
                        >
                            <span className={`h-2 w-2 rounded-full ${!shiftLoaded ? "bg-muted-foreground/40" : activeShift ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {!shiftLoaded ? "Shift…" : activeShift ? `Shift #${activeShift.id}` : "No shift"}
                            <MoreVertical size={13} className="opacity-60" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-xs">
                        {activeShift?.status === "OPEN" ? (
                            <>
                                <DropdownMenuLabel className="font-normal text-muted-foreground">
                                    {activeShift.counter.name} · since {shiftOpenedAt}
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={refreshActiveShift}>
                                    <RefreshCw size={12} /> Refresh
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setShiftDropOpen(true)}>
                                    <Lock size={12} /> Drop to safe
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setShiftCloseOpen(true)}
                                    className="text-amber-700 focus:text-amber-700 dark:text-amber-400"
                                >
                                    <ArrowRightLeft size={12} /> Close shift
                                </DropdownMenuItem>
                            </>
                        ) : activeShift?.status === "AWAITING_HANDOVER" ? (
                            <DropdownMenuLabel className="font-normal text-amber-700 dark:text-amber-400">
                                Awaiting handover — see the bar above
                            </DropdownMenuLabel>
                        ) : (
                            <DropdownMenuItem onClick={() => setShiftOpenDialogOpen(true)}>
                                <Lock size={12} /> Open shift
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link href="/vouchers/pos">
                                <Monitor size={12} /> POS sales register
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

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
                    counterName={activeShift.counter.tillAccount.name}
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
                                                            <span className={mrp != null && mrp !== l.unitPrice ? "line-through" : ""}>{mrp != null ? fmtINR(mrp) : "—"}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="uppercase tracking-wider">Barcode</span>
                                                            <span>{barcode != null ? fmtINR(barcode) : "—"}</span>
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

                        {/* Totals + checkout */}
                        <div className="shrink-0 space-y-2 border-t border-border p-4">
                            {/* Subtotal is the tax-INCLUSIVE cart value (price-tag-style).
                                When the operator hasn't added shipping / round-off / charges,
                                Subtotal equals Total. The CGST/SGST split underneath is
                                informational — cashiers and printed receipts show the breakdown
                                but the math has already happened in the per-line inclusive price. */}
                            {/* Subtotal — the tax (incl.) SGST/CGST breakdown rides in the
                                middle of this bar so it no longer needs its own row. */}
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <span>Subtotal</span>
                                {tax > 0.005 && (
                                    <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                                        incl. GST · SGST {fmtINR(tax / 2)} + CGST {fmtINR(tax / 2)} = {fmtINR(tax)}
                                    </span>
                                )}
                                <span className="font-medium">{fmtINR(subtotal + tax)}</span>
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
                                            <span className="font-medium tabular-nums">− {fmtINR(discountAmount)}</span>
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
                                                    onChange={(e) => setRedeemPointsStr(digitsInt(e.target.value))}
                                                    placeholder="0"
                                                    className="h-5 w-20 text-right text-xs"
                                                />
                                            )}
                                            <span className="text-[10px] opacity-70">
                                                {couponBlockedLoyalty
                                                    ? "(blocked by coupon)"
                                                    : redeemBlocked
                                                        ? `(redeem from ${fmtINR(rates.minRedeemInvoiceValue ?? 0)})`
                                                        : `(${loyaltyBalance} avail · ${fmtINR(rates.redeemValue)}/pt)`}
                                            </span>
                                            {effRedemptionRupees > 0.005 && (
                                                <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {fmtINR(effRedemptionRupees)}</span>
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
                                                Total discount − {fmtINR(totalDiscount)}
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
                                            <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {fmtINR(couponRupees)}</span>
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
                                                    <Sparkles size={11} /> Auto offer{autoCoupon.code ? ` ${autoCoupon.code}` : ""} · − {fmtINR(autoCoupon.rupees)}
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
                                            <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">− {fmtINR(giftCardApplied)}</span>
                                            <span className="text-[10px] text-muted-foreground">bal {fmtINR(Math.max(0, giftCard.balance - giftCardApplied))} after</span>
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
                                    <span className="tabular-nums">{fmtINR(payableTotal)}</span>
                                </div>
                            )}

                            {/* ── Collapsible Adjustments panel ────────────────
                                Shipping + Round-off + Charges. Mirrors office
                                SALE (TradingVoucherPage). Hidden by default —
                                expanded only when the cashier needs them. */}
                            {(() => {
                                const adjustmentsCount =
                                    (shippingAmt > 0 ? 1 : 0) +
                                    (Math.abs(roundOff) >= 0.005 ? 1 : 0) +
                                    charges.filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005).length;
                                return (
                                    <div className="rounded border border-border/60 bg-muted/30">
                                        <button
                                            type="button"
                                            onClick={() => setAdjustmentsOpen((o) => !o)}
                                            className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                                        >
                                            <span className="inline-flex items-center gap-1">
                                                {adjustmentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                Adjustments
                                                {adjustmentsCount > 0 && (
                                                    <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{adjustmentsCount}</Badge>
                                                )}
                                            </span>
                                            <span className="text-[10px] opacity-60">Shipping · Round-off · Charges</span>
                                        </button>
                                        {adjustmentsOpen && (
                                            <div className="space-y-2 border-t border-border/60 px-2 py-2">
                                                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                                                    <Label htmlFor="pos-shipping" className="text-xs text-muted-foreground">Shipping</Label>
                                                    <Input
                                                        id="pos-shipping"
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={shippingAmtStr}
                                                        onChange={(e) => setShippingAmtStr(numUnsigned(e.target.value))}
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
                                    </div>
                                );
                            })()}

                            <div className="flex items-baseline justify-between border-t border-border pt-2.5">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-base font-semibold">Total</span>
                                    {cart.length > 0 && (
                                        <span className="text-[11px] text-muted-foreground">{cart.length} item{cart.length > 1 ? "s" : ""}</span>
                                    )}
                                </div>
                                <span className="text-xl font-bold tabular-nums">{fmtINR(total)}</span>
                            </div>
                            <Button onClick={openCheckout} disabled={cart.length === 0 || !snapshot?.account} className="h-12 w-full text-base" size="lg">
                                <ReceiptIndianRupee size={18} /> Save Order
                                <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                            </Button>
                        </div>
                    </div>
                </main>

                {/* Right column — customer "we know you" panel */}
                <aside className="flex min-h-0 flex-col overflow-y-auto bg-muted/30 p-4">
                    {!snapshot ? (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
                            <div className="mb-2 rounded-full bg-muted p-3">
                                <User size={24} className="opacity-50" />
                            </div>
                            <p className="text-sm font-medium text-foreground/80">No customer selected</p>
                            <p className="mt-0.5 text-xs">Search by name, phone or email above — or add a walk-in to see their dues, loyalty &amp; offers.</p>
                        </div>
                    ) : loadingSnapshot ? (
                        <div className="text-sm text-muted-foreground">Loading…</div>
                    ) : (
                        <CustomerPanel snapshot={snapshot} />
                    )}
                </aside>
            </div>

            {/* ── Checkout dialog — fixed Cash / UPI / Credit rows ──────────────── */}
            <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Save Order · {fmtINR(total)} <span className="text-sm font-normal text-muted-foreground">— advance optional</span></DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3 text-center text-sm">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                                <div className="font-semibold">{fmtINR(total)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</div>
                                <div className="font-semibold">{fmtINR(collected)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">On credit</div>
                                <div className={`font-semibold ${onCredit > 0 ? "text-amber-600" : "text-emerald-600"}`}>{fmtINR(onCredit)}</div>
                            </div>
                        </div>

                        {giftCardApplied > 0.005 && (
                            <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm dark:border-teal-500/30 dark:bg-teal-500/10">
                                <span className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300"><CreditCard size={14} /> Gift card {giftCard?.code} − {fmtINR(giftCardApplied)}</span>
                                <span className="font-semibold tabular-nums">Pay {fmtINR(payableTotal)}</span>
                            </div>
                        )}

                        {/* Order: advance is OPTIONAL — no credit-limit block here. */}
                        <div className="flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>Advance is optional — leave the amounts blank to book the order with no payment. Any amount collected posts a separate Receipt voucher on the customer&apos;s account.</span>
                        </div>

                        {(() => {
                            // Enter on any amount field → confirm. Tab walks Cash → UPI → Confirm
                            // (Cash-return is tabIndex=-1 and skipped; clickable for chip-changing).
                            const enterToSubmit = (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void generateInvoice(e.ctrlKey || e.metaKey);
                                }
                            };
                            return (
                                <div className="space-y-2">
                                    {/* Cash — tendered + return on the same row, hint with net cash */}
                                    <div className="grid grid-cols-[80px_1fr_auto_1fr] items-center gap-2">
                                        <Label className="flex items-center gap-1 text-xs">
                                            <Banknote size={12} /> Cash
                                            <button
                                                type="button"
                                                title="Fill remaining amount in cash"
                                                onClick={() => {
                                                    const remaining = Math.max(0, +(payableTotal - pay.upi - extrasSum).toFixed(2));
                                                    setPay((s) => ({ ...s, cashTendered: remaining, cashReturn: 0 }));
                                                    setTimeout(() => cashTenderedRef.current?.select(), 0);
                                                }}
                                                className="ml-0.5 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-0.5 transition-colors"
                                            >
                                                <Check size={11} strokeWidth={2.5} />
                                            </button>
                                        </Label>
                                        <Input
                                            ref={cashTenderedRef}
                                            value={pay.cashTendered || ""}
                                            onChange={(e) => setPay((s) => ({ ...s, cashTendered: Number(e.target.value) || 0 }))}
                                            onKeyDown={enterToSubmit}
                                            placeholder="₹ tendered"
                                            inputMode="decimal"
                                            className="text-right"
                                        />
                                        <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">return</Label>
                                        <Input
                                            value={pay.cashReturn || ""}
                                            onChange={(e) => setPay((s) => ({ ...s, cashReturn: Number(e.target.value) || 0 }))}
                                            onKeyDown={enterToSubmit}
                                            placeholder="₹ change back"
                                            inputMode="decimal"
                                            className="text-right"
                                        />
                                    </div>
                                    {pay.cashReturn > 0 && (
                                        <div className="pl-[88px] text-[11px] text-muted-foreground">
                                            net cash {fmtINR(cashNet)} = ₹{pay.cashTendered} − ₹{pay.cashReturn} return
                                        </div>
                                    )}

                                    {/* UPI — only shown when this counter accepts UPI.
                                        Counter may override the label (e.g. "PhonePe"). */}
                                    {counterMethods.upi && (
                                        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                                            <Label className="flex items-center gap-1 text-xs">
                                                <Smartphone size={12} /> {upiLabel}
                                                <button
                                                    type="button"
                                                    title={`Fill remaining amount in ${upiLabel}`}
                                                    onClick={() => {
                                                        const remaining = Math.max(0, +(payableTotal - cashNet - extrasSum).toFixed(2));
                                                        setPay((s) => ({ ...s, upi: remaining }));
                                                        setTimeout(() => upiAmountRef.current?.select(), 0);
                                                    }}
                                                    className="ml-0.5 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 p-0.5 transition-colors"
                                                >
                                                    <Check size={11} strokeWidth={2.5} />
                                                </button>
                                            </Label>
                                            <Input
                                                ref={upiAmountRef}
                                                value={pay.upi || ""}
                                                onChange={(e) => setPay((s) => ({ ...s, upi: Number(e.target.value) || 0 }))}
                                                onKeyDown={enterToSubmit}
                                                placeholder="₹ amount"
                                                inputMode="decimal"
                                                className="text-right"
                                            />
                                        </div>
                                    )}

                                    {/* Extras — Card / Cheque / Bank Transfer / Wallet (added on demand,
                                        only methods mapped on this counter appear in the picker) */}
                                    {extras.map((e) => (
                                        <div key={e.id} className="grid grid-cols-[160px_1fr_1fr_auto] items-center gap-2">
                                            <Select
                                                value={e.method}
                                                onValueChange={(v) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, method: v as ExtraMethod } : x))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {allowedExtras.map((m) => (
                                                        <SelectItem key={m.value} value={m.value}>
                                                            <span className="flex items-center gap-2">{m.icon} {m.label}</span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Input
                                                value={e.amount || ""}
                                                onChange={(ev) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, amount: Number(ev.target.value) || 0 } : x))}
                                                onKeyDown={enterToSubmit}
                                                placeholder="₹ amount"
                                                className="text-right"
                                                inputMode="decimal"
                                            />
                                            <Input
                                                value={e.reference}
                                                onChange={(ev) => setExtras((prev) => prev.map((x) => x.id === e.id ? { ...x, reference: ev.target.value } : x))}
                                                onKeyDown={enterToSubmit}
                                                placeholder="Ref / last-4"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => setExtras((prev) => prev.filter((x) => x.id !== e.id))}
                                                title="Remove"
                                            >
                                                <Trash2 size={12} className="text-destructive" />
                                            </Button>
                                        </div>
                                    ))}

                                    {/* Credit — readonly, auto-balanced */}
                                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock size={12} /> Credit</Label>
                                        <Input
                                            value={onCredit ? onCredit.toFixed(2) : ""}
                                            readOnly
                                            tabIndex={-1}
                                            placeholder="auto"
                                            className="bg-muted/50 cursor-default text-right"
                                            title="Auto-balanced — fill Cash / UPI / Card etc. and the rest goes on credit"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={allowedExtras.length === 0}
                                            title={allowedExtras.length === 0 ? "This counter only accepts Cash (+ UPI if mapped). Map more methods under /office/admin/counters." : undefined}
                                            onClick={() => {
                                                const seed = allowedExtras[0]?.value;
                                                if (!seed) return;
                                                setExtras((prev) => [...prev, { id: crypto.randomUUID(), method: seed, amount: 0, reference: "" }]);
                                            }}
                                        >
                                            <Plus size={14} /> Add payment line
                                        </Button>

                                        <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : `Confirm · ${fmtINR(total)}`}
                                        <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span>
                                    </div>
                                    {/* Overpayment is collected on Confirm: the extra clears the oldest
                                        open bills first (FIFO), and any leftover becomes a customer
                                        advance — booked as a separate GST Receipt voucher so the bank/UPI
                                        statement matches 1:1. */}
                                    {(overpaid > 0 || balanceDue > 0) && (
                                        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                                            {balanceDue > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-muted-foreground">Existing dues</span>
                                                    <span className="font-medium text-amber-600">{fmtINR(balanceDue)}</span>
                                                </div>
                                            )}
                                            {overpaid > 0 && (
                                                <>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-muted-foreground">Extra collected</span>
                                                        <span className="font-medium text-foreground">{fmtINR(overpaid)}</span>
                                                    </div>
                                                    {arrearPaid > 0 && (
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-muted-foreground">→ Clears old dues</span>
                                                            <span className="font-medium text-emerald-600">{fmtINR(arrearPaid)}</span>
                                                        </div>
                                                    )}
                                                    {advanceTaken > 0 && (
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-muted-foreground">→ Advance / credit</span>
                                                            <span className="font-medium text-emerald-600">{fmtINR(advanceTaken)}</span>
                                                        </div>
                                                    )}
                                                    <p className="text-[11px] leading-snug text-muted-foreground">
                                                        Confirm issues a Receipt voucher for the extra. Needs an identified customer (not a walk-in).
                                                    </p>
                                                </>
                                            )}
                                            {overpaid <= 0 && balanceDue > 0 && (
                                                <p className="text-[11px] leading-snug text-muted-foreground">
                                                    Collect dues by tendering more than the bill — the extra clears the oldest bills first.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {/* Inline confirm CTAs — final amount + actions sit close to the payment-line entry */}
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        <Button onClick={() => generateInvoice(false)} disabled={submitting} size="lg" variant="outline">
                                            <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : "Save Order"}
                                            <span className="ml-2 rounded border border-primary-foreground/30 px-1.5 py-px text-[10px] opacity-80">↵</span>
                                        </Button>
                                        <Button onClick={() => generateInvoice(true)} disabled={submitting} size="lg">
                                            <ReceiptIndianRupee size={16} /> {submitting ? "Saving…" : "Save + Print"}
                                            <span className="ml-2 rounded border border-border px-1.5 py-px text-[10px] opacity-80">Ctrl ↵</span>
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={submitting}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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

function CustomerPanel({ snapshot }: { snapshot: Snapshot }) {
    const c = snapshot.party;
    const levelColor =
        snapshot.customerLevel === "Platinum" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" :
            snapshot.customerLevel === "Gold" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" :
                snapshot.customerLevel === "Silver" ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" :
                    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300";
    return (
        <div className="space-y-3">
            {/* Identity */}
            <div>
                <div className="flex items-center gap-2">
                    {c.kind === "company" ? <Building2 size={16} className="shrink-0 text-muted-foreground" /> : <User size={16} className="shrink-0 text-muted-foreground" />}
                    <h2 className="truncate text-base font-semibold">{c.name}</h2>
                    {snapshot.customerLevel && <Badge className={`text-[10px] ${levelColor}`}>{snapshot.customerLevel}</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {c.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {c.phone}</span>}
                    {c.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {c.email}</span>}
                    {c.gstin && <span className="font-mono">GSTIN {c.gstin}</span>}
                    {c.address && <span className="inline-flex basis-full items-start gap-1"><MapPin size={11} className="mt-0.5 shrink-0" /> <span className="whitespace-pre-line">{c.address}</span></span>}
                </div>
            </div>

            {/* Money — credit / due / overdue (risk-at-a-glance) */}
            <div className="grid grid-cols-3 gap-1.5">
                <Stat
                    icon={<CreditCard size={14} />}
                    label="Avail. credit"
                    value={snapshot.availableCredit != null ? fmtINR(snapshot.availableCredit) : "Unlimited"}
                    sub={snapshot.creditLimit != null ? `limit ${fmtINR(snapshot.creditLimit)}` : "no limit set"}
                />
                {/* Due — sign-aware: flips to "Advance" (green) when the ledger is
                    in credit, so it absorbs the old separate ledger-balance row. */}
                {(() => {
                    const bal = snapshot.account ? snapshot.account.balance : snapshot.balanceDue;
                    const credit = bal < 0;
                    return (
                        <Stat
                            icon={credit ? <Wallet size={14} /> : <TrendingDown size={14} />}
                            label={credit ? "Advance" : "Due"}
                            value={fmtINR(credit ? Math.abs(bal) : snapshot.balanceDue)}
                            sub={credit ? "in their favour" : snapshot.balanceDue > 0 ? "outstanding" : "clean"}
                            valueClass={credit ? "text-emerald-600 dark:text-emerald-400" : undefined}
                        />
                    );
                })()}
                <Stat
                    icon={<AlertCircle size={14} />}
                    label="Overdue"
                    value={fmtINR(snapshot.balanceOverdue)}
                    sub={snapshot.balanceOverdue > 0 ? "past due" : "—"}
                />
            </div>

            {/* Offers & cross-sell — pulled up and highlighted so the cashier
                pitches before checkout. Empty state nudges an add-on/AMC sale. */}
            {snapshot.personalizedOffers.length > 0 ? (
                <div className="rounded-lg border border-emerald-300/50 bg-gradient-to-br from-emerald-500/10 to-transparent p-2.5">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        <Sparkles size={12} /> Offers to pitch
                    </div>
                    <ul className="space-y-1.5">
                        {snapshot.personalizedOffers.map((o) => (
                            <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-emerald-300/40 bg-card px-2.5 py-1.5 text-xs">
                                <span className="truncate">{o.label}</span>
                                <Badge variant="secondary" className="shrink-0 text-[10px]">{o.tag}</Badge>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-emerald-300/40 bg-emerald-500/5 p-2.5 text-[11px]">
                    <div className="mb-0.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        <Sparkles size={11} /> Upsell &amp; cross-sell
                    </div>
                    <p className="text-muted-foreground">
                        {snapshot.favouriteCategory
                            ? <>No coupon yet — they favour <span className="font-medium text-foreground">{snapshot.favouriteCategory}</span>. Suggest an add-on, accessory, or AMC.</>
                            : "No targeted offer yet — pitch an accessory, extended warranty, or AMC."}
                    </p>
                </div>
            )}

            {/* Value & loyalty */}
            <div className="grid grid-cols-2 gap-1.5">
                <Stat icon={<TrendingUp size={14} />} label="Lifetime turnover" value={fmtINR(snapshot.turnover.lifetime)} sub={`${snapshot.turnover.invoiceCount} invoices`} />
                <Stat icon={<TrendingUp size={14} />} label="Last 12 mo" value={fmtINR(snapshot.turnover.last12Months)} />
                <Stat icon={<Award size={14} />} label="Loyalty points" value={String(snapshot.loyaltyPoints)} sub={snapshot.loyaltyRates?.enabled ? `worth ${fmtINR(snapshot.loyaltyPoints * snapshot.loyaltyRates.redeemValue)} · 1 pt / ₹${snapshot.loyaltyRates.globalEarnRatePer}` : snapshot.discountPct > 0 ? `${snapshot.discountPct}% discount tier` : "No tier yet"} />
                <Stat icon={<Clock size={14} />} label="Last visit" value={since(snapshot.lastVisitAt)} />
            </div>

            {/* Rating + favourite category */}
            <div className="grid grid-cols-2 gap-1.5">
                <Stat
                    icon={<Star size={14} />}
                    label="Rating"
                    value={snapshot.rating != null ? `${snapshot.rating.toFixed(1)} / 5` : "—"}
                    sub={snapshot.rating == null ? "no rating yet" : undefined}
                />
                <Stat
                    icon={<Tag size={14} />}
                    label="Favourite"
                    value={snapshot.favouriteCategory ?? "—"}
                    sub={snapshot.favouriteCategory == null ? "needs invoice link" : undefined}
                />
            </div>

            {snapshot.recentTickets.length > 0 && (
                <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent tickets</div>
                    <ul className="space-y-1.5">
                        {snapshot.recentTickets.map((t) => (
                            <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                                <span className="font-mono">#{t.id}</span>
                                <Badge variant="secondary" className="text-[10px]">{t.statusLabel}</Badge>
                                <span className="text-muted-foreground">{since(t.createdAt)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {snapshot.warrantiesEnding.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
                    <div className="mb-1 font-semibold text-amber-700">Warranties ending soon</div>
                    {snapshot.warrantiesEnding.map((w) => (
                        <div key={w.productName} className="flex items-center justify-between">
                            <span className="truncate">{w.productName}</span>
                            <span className="text-muted-foreground">{w.endsAt}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Stat({ icon, label, value, sub, valueClass }: { icon: React.ReactNode; label: string; value: string; sub?: string; valueClass?: string }) {
    return (
        <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {icon} {label}
            </div>
            <div className={`mt-0.5 text-sm font-semibold leading-tight tabular-nums ${valueClass ?? ""}`}>{value}</div>
            {sub && <div className="text-[10px] leading-tight text-muted-foreground">{sub}</div>}
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
