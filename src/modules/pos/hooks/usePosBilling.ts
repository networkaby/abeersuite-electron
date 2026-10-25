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
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { openPosHelpTab, POS_HELP_URL } from "@/modules/pos/lib/posHelp";
import { calcVoucherTotals, calcLineTotals, resolveShippingGstRate } from "@/modules/inventory/lib/voucherMath";
import { type PartySearchAndCreateHandle, type PickedParty } from "@/shared/components/PartySearchAndCreate";
import { type TenderSplit } from "@/modules/pos/components/TenderSplitInput";
import { usePosAccess } from "@/modules/pos/hooks/usePosAccess";
import { usePosCustomerDisplay } from "@/modules/pos/hooks/usePosCustomerDisplay";
import { usePosDisplaySlides } from "@/modules/pos/hooks/usePosDisplaySlides";
import { qrDisplay } from "@/modules/pos/lib/qrDisplay";
import { DEFAULT_PAYEE_NAME } from "@/modules/pos/lib/paymentLink";
import { formatInr, parseDigitsInput, round2 } from "@/shared/lib/format";
import { resolveTierTitles } from "@/shared/lib/pricing";
import { groupRebatesExcl, groupStartPricePaise, rebatedRate, ruleForGroup } from "@/modules/pricing-strategy/lib/groupPricing";
import { mdrRecovery, upiPlan, upliftedRates, type UpiPart, type UpliftLine } from "@/modules/pos/lib/paymentMdr";
import { CHANNEL_LABEL } from "@/modules/pos/lib/counterTenders";
import { type UpiPanelState } from "@/modules/pos/components/UpiPartsPanel";
import { usePosDraftStore } from "@/store/posDraftStore";
import { type Snapshot, type ProductOption, type PosServiceOption, type CartLine, type CouponHit, type OnTopHit, type PosOffer } from "@/modules/pos/lib/posDraftTypes";
import { searchProducts } from "@/shared/lib/inventory";
import { useRealtimeTopics } from "@/shared/hooks/useRealtimeTopics";
import { useValueChange } from "@/shared/hooks/useValueChange";
import { focusWhenReady } from "@/shared/lib/ui/focusWhenReady";
import { parseAmt, type EditBill } from "@/modules/pos/hooks/posBilling/types";
import { usePosShift } from "@/modules/pos/hooks/posBilling/usePosShift";
import { usePosCatalogue } from "@/modules/pos/hooks/posBilling/usePosCatalogue";

/** How many rows the product dropdown shows — kept constant so the list does
 *  not change height between a good query and a poor one. */
const DROPDOWN_ROWS = 12;

// Moved to posBilling/types.ts; re-exported so the screens' imports stay as they were.
export { parseAmt, type EditBill };

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
    /** Work the customer group's silent rebate into the bill (Pricing Strategy
     *  → Group pricing). Only a NEW POS sale posts it — /api/pos/sale works the
     *  same rebate out server-side. Orders, estimates and an edited sale (whose
     *  stored rates already carry it) leave it off. */
    groupRebate?: boolean;
    /** Work each payment method's bank charge (MDR) into the bill and take big
     *  UPI payments in parts (paymentMdr.ts). A NEW POS sale only — /api/pos/sale
     *  works the same out server-side; orders, estimates and edits leave it off. */
    paymentMdr?: boolean;
    /** Re-saving a posted POS sale on its SALE DAY's terms: that day's level %
     *  and loyalty rate, its own coupon and charge rows, its gift card; the
     *  payment re-taken on the counter it was rung on. null/absent = a fresh bill. */
    editBill?: EditBill | null;
}) {
    const { partySearchRef, productSearchRef, cashTenderedRef } = opts;
    const eb = opts.editBill ?? null;
    // Router for the help-page fallback when the browser blocks the new tab.
    const router = useRouter();
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
    // Has the cashier deliberately moved the highlight (arrow keys / hover)?
    // Guards Enter against silently adding a "guess" row — an unknown barcode
    // ends in Enter too, and a wrong item on the bill is worse than no item.
    const [highlightTouched, setHighlightTouched] = useState(false);
    // Product Explorer hover — shown standalone on the customer-facing DQ11
    // ("Add this item?") while the cashier's mouse rests on a tile, so the
    // customer can see and agree to it before it lands in the cart. null =
    // not hovering (usePosCustomerDisplay falls through to the real cart).
    const [hoverPreviewProduct, setHoverPreviewProduct] = useState<ProductOption | null>(null);
    const cart = usePosDraftStore((s) => s.cart);
    const setCart = usePosDraftStore((s) => s.setCart);

    // ── Checkout / payment splits ───────────────────────────────────────────
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    // Mid-bill clear confirmation (Shift+Esc) — wipes the cart + adjustments.
    const [clearCartDialogOpen, setClearCartDialogOpen] = useState(false);
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
    // Best auto-apply FREE-GRANT offer (independent FREE_ITEM / BOGO, no code) —
    // previews the granted free lines as rows in the item list the moment the
    // cart qualifies. The server re-selects it at checkout (freeAutoApply), so
    // this is display + the checkout hint only.
    const [autoFree, setAutoFree] = useState<OnTopHit | null>(null);
    // Independent FREE-GRANT coupon (FREE_ITEM / BOGO) — applies ON TOP of the
    // money coupon. It grants free items (zero-price lines with the FREE badge)
    // instead of a ₹ discount; the server re-derives them from `freeCouponCode`.
    const [appliedFree, setAppliedFree] = useState<OnTopHit | null>(null);
    const [freeBusy, setFreeBusy] = useState(false);
    // Live offers panel — every claimable POS offer with qualification progress
    // + cross-sell suggestions (server-computed; see /api/pos/coupon-offers).
    // The upsell drawer renders these; this hook owns only data + one-click apply.
    const [offers, setOffers] = useState<PosOffer[] | null>(null);
    const [crossSell, setCrossSell] = useState<ProductOption[]>([]);
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
    const convertFrom = usePosDraftStore((s) => s.convertFrom);
    const setConvertFrom = usePosDraftStore((s) => s.setConvertFrom);

    // ── Active POS shift ────────────────────────────────────────────────────
    // Mount order, takeover and the shift dialogs: see posBilling/usePosShift.ts.
    const {
        activeShift, setActiveShift, takeover, setTakeover, shiftLoaded,
        shiftOpenDialogOpen, setShiftOpenDialogOpen,
        returnDialogOpen, setReturnDialogOpen,
        expenditureDialogOpen, setExpenditureDialogOpen,
        receiptDialogOpen, setReceiptDialogOpen,
        shiftDropOpen, setShiftDropOpen,
        shiftCloseOpen, setShiftCloseOpen,
        refreshActiveShift, openTakeover,
    } = usePosShift();

    // The counter's non-cash payment accounts (UPI 1 → HDFC, UPI 2 → SBI, Card…),
    // configured under /office/admin/counters. Each checkout split picks one of
    // these. Cash is always accepted (routes to till) and isn't in this list.
    const editPayAccounts = eb?.payAccounts ?? undefined;
    const payAccounts = useMemo(
        () => editPayAccounts ?? activeShift?.counter.paymentAccounts ?? [],
        [editPayAccounts, activeShift],
    );
    const payAccountById = useMemo(
        () => new Map(payAccounts.map((a) => [a.id, a])),
        [payAccounts],
    );

    // ── Effects ─────────────────────────────────────────────────────────────

    // The product list and the POS services, loaded and kept current: see
    // posBilling/usePosCatalogue.ts.
    const { allProducts, setAllProducts, allServices } = usePosCatalogue();

    // The counter's own configuration — payment accounts (the checkout's UPI /
    // Card rows), allowed expense ledgers, till account, EPBX — rides in on the
    // shift payload, which was read ONCE at mount. A save under
    // /office/admin/counters announces `settings`; without this the till kept
    // showing yesterday's payment rows until someone reloaded the screen, and a
    // freshly added UPI was invisible to the cashier with the office insisting
    // it was configured. The shift itself is cheap to re-read and the refresh
    // touches no cart state.
    useRealtimeTopics(["settings"], () => { refreshActiveShift(); });

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

    // Latest payable total for the early-bound "/" shortcut effect below
    // (it lives above the computed totals). A ref, so the listener never
    // needs re-binding; the value is refreshed after every render.
    const payableTotalRef = useRef(0);
    // Same, for the amount a payment row needs to settle the bill (coverAmount
    // below — the bill moves with a row that carries a bank charge).
    const coverAmountRef = useRef<(rows: TenderSplit[], id: string, cash: number) => number>(() => 0);

    // "/" — two roles:
    //   • Checkout open → fill the REST of the bill into the focused payment
    //     line (the keyboard version of each line's ✓ fill-remaining helper):
    //     cash row / no line focused → cash gets the rest; a payment line's
    //     amount/ref box → that line gets the rest. Works from any field in
    //     the checkout, including the cash input itself.
    //   • Otherwise → focus the product search box (skip when the user is
    //     already typing in an input/textarea/contenteditable, or when a dialog
    //     is open).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "/") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (checkoutOpen) {
                e.preventDefault();
                // "/" on ANY payment line → fill the REST of the bill into that
                // line (the keyboard version of each line's ✓ fill-remaining
                // helper). Cash row — or no line focused — → the rest goes to cash.
                const active = document.activeElement as HTMLElement | null;
                const splitId = active?.closest?.("[data-tender-split]")?.getAttribute("data-tender-split") ?? null;
                const bill = payableTotalRef.current;
                const splitsSum = splits.reduce((s, x) => s + x.amount, 0);
                const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
                if (splitId != null) {
                    const row = splits.find((x) => x.id === splitId);
                    if (row) {
                        // Never below the UPI parts already received on the row.
                        const inAlready = (row.plan ?? []).reduce((sum, p) => sum + (p.received ? p.amount : 0), 0);
                        const remaining = Math.max(inAlready, coverAmountRef.current(splits, splitId, cashNet));
                        setSplits((prev) => prev.map((x) => (x.id === splitId ? { ...x, amount: remaining } : x)));
                    }
                } else {
                    const remaining = Math.max(0, +(bill - splitsSum).toFixed(2));
                    setPay((s) => ({ ...s, cashTendered: remaining, cashReturn: 0 }));
                }
                return;
            }
            if (createDialogOpen) return;
            const tag = (document.activeElement as HTMLElement | null)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
            e.preventDefault();
            productSearchRef.current?.focus();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [checkoutOpen, payableTotalRef, coverAmountRef, setPay, setSplits, createDialogOpen, productSearchRef, pay, splits]);

    // F2 from anywhere → focus the party / customer picker.
    // Standard POS convention: F2 = customer lookup, / = product scan.
    // F2 is a function key — it overrides the current context and works even
    // when focus is inside an input (product search, cart line, etc.).
    // If a party is already selected, enters "change mode" instead: unlocks
    // the picker, remembers the original party, and lets the cashier search
    // for a replacement. Esc restores the original; picking a new one swaps.

    // "Change customer" mode state — declared before the handlers that read it.
    const [changingParty, setChangingParty] = useState(false);
    const changingPartyRef = useRef(changingParty);
    useEffect(() => { changingPartyRef.current = changingParty; }, [changingParty]);
    const originalPartyRef = useRef<PickedParty | null>(null);

    // The selected cart line — the "+"/"-" quantity keys act on it. Defaults
    // to the last item scanned / added; ArrowUp/Down move it; clicking a line
    // selects it (see PosScreenShell). Keyed by productId (not index) so it
    // survives the render sort (products before services).
    const [cartSelectedId, setCartSelectedId] = useState<number | null>(null);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "F2") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (createDialogOpen || checkoutOpen) return;
            e.preventDefault();
            if (snapshot?.account) {
                originalPartyRef.current = {
                    kind: snapshot.party.kind === "person" ? "customer" : snapshot.party.kind,
                    id: snapshot.party.id,
                    name: snapshot.party.name,
                    phone: snapshot.party.phone,
                    accountId: snapshot.account.id,
                };
                setChangingParty(true);
                partySearchRef.current?.clear();
            }
            partySearchRef.current?.focus();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [createDialogOpen, checkoutOpen, snapshot?.account, snapshot?.party?.id, snapshot?.party?.kind, snapshot?.party?.name, snapshot?.party?.phone, partySearchRef]);

    // F6 from anywhere → open a fresh POS tab. The POS supports multiple
    // simultaneous tabs, so there is no recall shortcut — the cashier returns
    // to a held bill by switching tabs manually. Mirrors the mouse "New Tab"
    // button in PosTopBar (window.open("/vouchers/pos/new")).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "F6") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            e.preventDefault();
            window.open("/vouchers/pos/new", "_blank", "noopener");
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

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

    // Offer-product slides for that slideshow, refreshed every few hours.
    usePosDisplaySlides();

    // ── Computed ────────────────────────────────────────────────────────────

    // Products only — services have no barcode, so they are NOT scannable/typed
    // here; they are added from the "+ Add service charge" button in the cart.
    //
    // `fallback: true` is the till's own setting — a cashier with a customer
    // waiting is better served by a full list of suggestions than by a blank
    // box, so a failed search is topped up (see searchProducts). Everywhere
    // else in the app the fallback stays off. `guessIds` is what the dropdown
    // colours amber.
    const { filteredProducts, productGuessIds } = useMemo(() => {
        const { rows, guessIds } = searchProducts(allProducts, productQuery, {
            rows: DROPDOWN_ROWS,
            fallback: true,
        });
        return { filteredProducts: rows, productGuessIds: guessIds };
    }, [productQuery, allProducts]);

    // A fresh query is a fresh list — the cashier has not aimed at anything yet.
    if (useValueChange(productQuery)) setHighlightTouched(false);

    // Per-line tax via the same calcLineTotals helper office SALE uses, so
    // POS and SALE always compute identical GST. POS has no per-line discount
    // today (only voucher-level loyalty %) so discountPct/Amt are 0 here.
    // These are the rows BEFORE any customer-group rebate — the tier, loyalty
    // and coupon math reads them; the bill itself shows `billLineRows` below.
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
    // An edit carries the sale's own charge rows (services, manual charges), not the box.
    const manualChargesNet = eb ? eb.chargesNet : charges.reduce((s, c) => s + parseAmt(c.amount), 0);

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
    // An edit stays on the level % of its sale day, never today's.
    const discountPct = eb ? eb.promo.tierDiscountPct : tier.discountPct;

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
    // The product list by id, built once per catalogue load. The bill maths below
    // looks a line's product up several times per line on every render; a
    // `.find` over a catalogue of thousands made that lines × catalogue.
    const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
    const lineCostExcl = (l: CartLine): number | null => {
        const paise = l.costPaise ?? productById.get(l.productId)?.costPaise ?? null;
        return paise == null ? null : paise / 100;
    };
    // Discount-protection flag — snapshotted at add-to-cart, falling back to the
    // live product list for restored/edited carts (same pattern as costPaise).
    const lineProtected = (l: CartLine): boolean =>
        !!l.protected || (productById.get(l.productId)?.protected ?? false);
    // An edit keeps each unchanged line's saved discount to the paisa. A line whose
    // quantity or price moved takes its product's saved discount per unit (the sale
    // day's % of the sale day's cost); a product new to the bill, the sale day's %.
    const editUnitDisc = new Map<number, number>();
    for (const id of new Set(eb?.lines.map((o) => o.productId))) {
        const saved = eb?.lines.filter((o) => o.productId === id) ?? [];
        const qty = saved.reduce((sum, o) => sum + o.qty, 0);
        editUnitDisc.set(id, qty > 0 ? saved.reduce((sum, o) => sum + o.discountAmt, 0) / qty : 0);
    }
    const sameAsSaved = (l: CartLine, i: number) => {
        const o = eb?.lines[i];
        return !!o && o.productId === l.productId && o.qty === l.qty && o.unitPrice === l.unitPrice;
    };
    const editLinesUnchanged = !!eb && cart.length === eb.lines.length && cart.every(sameAsSaved);
    const lineTierDiscExcl = cart.map((l, i) => {
        if (eb && sameAsSaved(l, i)) return eb.lines[i].discountAmt;
        const perUnit = eb ? editUnitDisc.get(l.productId) : undefined;
        if (perUnit != null) return Math.min(round2(perUnit * l.qty), l.qty * l.unitPrice);
        const c = lineCostExcl(l);
        if (c == null || discountPct <= 0 || lineProtected(l)) return 0;
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
    // An edit redeems at its sale day's rates, up to the points it may use (posSaleEdit.ts).
    const rates = eb ? eb.promo.loyaltyRates : snapshot?.loyaltyRates ?? null;
    // Redemption is live only while the programme AND its redeem gate are on.
    const canRedeem = !!rates?.enabled && !!rates?.redeemEnabled;
    const loyaltyBalance = eb ? eb.maxRedeem : snapshot?.loyaltyPoints ?? 0;
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
    // which carry products only). Discount-protected lines are dropped too: no
    // redemption against a protected product (mirrors the server's blacklist).
    const goodsCart = cart.filter((l) => l.kind !== "service" && !lineProtected(l));
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
    const cartCapPts = rates && rates.redeemValue > 0 ? Math.floor(maxRedeemableRupees / rates.redeemValue) : 0;
    // The points an unchanged edit already redeemed stay redeemable whatever the cap reads now.
    const maxRedeemablePts = eb && editLinesUnchanged ? Math.max(cartCapPts, eb.redeemedBefore) : cartCapPts;
    const cappedPts = Math.min(requestedPts, loyaltyBalance, maxRedeemablePts);
    const redeemPts = cappedPts >= minRedeemPts || (eb != null && cappedPts === eb.redeemedBefore) ? cappedPts : 0;
    const redemptionRupees = eb && redeemPts === eb.redeemedBefore
        ? eb.redeemRupeesBefore
        : rates ? redeemPts * rates.redeemValue : 0;

    // ── Coupon (server-validated) ──────────────────────────────────────────────
    // A non-stackable coupon DROPS the tier discount + BLOCKS loyalty redemption;
    // the validate route already told us which, so mirror it in the bill so the
    // client total matches what the server will post.
    // Manual coupon wins; otherwise the best auto-apply offer (if any). An edit
    // keeps only the coupon its sale used — today's offers were not on that bill.
    const effectiveCoupon: CouponHit | null = eb
        ? (eb.coupon ? { couponId: -1, code: eb.coupon.code, name: eb.coupon.code, rupees: eb.coupon.rupees, droppedTier: false, blockedLoyalty: false } : null)
        : appliedCoupon ?? autoCoupon;
    const couponRupees = effectiveCoupon?.rupees ?? 0;
    const couponDroppedTier = !!effectiveCoupon?.droppedTier;
    const couponBlockedLoyalty = !!effectiveCoupon?.blockedLoyalty;
    const effDiscountAmount = couponDroppedTier ? 0 : discountAmount;
    const effRedemptionRupees = couponBlockedLoyalty ? 0 : redemptionRupees;
    const effRedeemPts = couponBlockedLoyalty ? 0 : redeemPts;

    // Combined customer-facing discount (tier + loyalty redemption + coupon).
    const totalDiscount = effDiscountAmount + effRedemptionRupees + couponRupees;

    // Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO on top: its ₹ is
    // an extra negative charge (never guard-clamped, never clears the money
    // coupon). The free-slot hit is either the grant (rule 1, ₹-less) or this.
    const effectiveFreeHit = eb ? null : appliedFree ?? autoFree;
    const onTopRupees = effectiveFreeHit?.onTop ? (effectiveFreeHit.rupees ?? 0) : 0;
    // Loyalty redemption + coupon + on-top all ride chargesNet as negative
    // charges, exactly as the server folds them into calcVoucherTotals.
    const chargesNet = manualChargesNet - effRedemptionRupees - couponRupees - onTopRupees;

    // ── Customer-group rebate (mirrors /api/pos/sale) ──────────────────────────
    // PROFIT_SHARE / REVENUE_DISCOUNT rules give back part of the profit still
    // left after every other discount, taken silently out of each line's rate
    // before GST. Same groupRebatesExcl, same inputs as the server — goods
    // lines only, bill-level discounts = coupon + on-top + loyalty + manual
    // minus charges — so the total collected here is the total it posts. No
    // rule → every rebate is 0 and the bill math below is exactly as before.
    const groupPricing = opts.groupRebate ? snapshot?.groupPricing ?? null : null;
    const lineTierAfterCoupon = lineTierDiscExcl.map((v) => (couponDroppedTier ? 0 : v));
    const lineRebateExcl = cart.map(() => 0);
    if (groupPricing) {
        const goodsIdx = cart.flatMap((l, i) => (l.kind !== "service" ? [i] : []));
        const billDiscountIncl = effRedemptionRupees + couponRupees + onTopRupees
            // Only the rows the sale actually sends (PosScreen's validCharges).
            + charges
                .filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005)
                .reduce((sum, c) => sum + Math.max(0, -parseAmt(c.amount)), 0);
        const rebates = groupRebatesExcl(goodsIdx.map((i) => {
            const l = cart[i];
            return {
                quantity: l.qty,
                unitPrice: l.unitPrice,
                taxRate: l.taxRate,
                tierDiscExcl: round2(lineTierAfterCoupon[i]),
                costExcl: lineCostExcl(l),
                protected: lineProtected(l),
                rule: ruleForGroup(groupPricing, l.groupId ?? productById.get(l.productId)?.groupId ?? null),
            };
        }), billDiscountIncl);
        goodsIdx.forEach((i, k) => { lineRebateExcl[i] = rebates[k]; });
    }
    // Each line's rate after the rebate — what the bill posts at before any
    // payment-method MDR moves it.
    const rebatedRates = cart.map((l, i) => rebatedRate(l.unitPrice, l.qty, lineRebateExcl[i]));

    // ── Payment-method MDR (mirrors /api/pos/sale — paymentMdr.ts) ──────────────
    // What the counter rings is the CASH price. A payment on a method with a bank
    // charge (card; UPI above its free limit) raises the line rates toward each
    // line's tag by that charge — the customer's "Today's discount" comes out
    // smaller, never past a tag. A new sale only; the inputs are the ones the
    // server builds from the same payments.
    const mdrLines: UpliftLine[] | null = opts.paymentMdr
        ? cart.map((l, i) => ({
            quantity: l.qty,
            rate: rebatedRates[i],
            taxRate: l.taxRate,
            tagPaise: l.barcodePaise ?? l.mrpPaise ?? null,
            fixed: l.kind === "service" || lineProtected(l),
        }))
        : null;
    // A row's UPI parts (paymentMdr.ts upiPlan): the plan the cashier is working
    // through while it still adds up, else received parts + the rest split afresh
    // (or as one payment) — or simply the row itself.
    const receivedOf = (s: TenderSplit): number[] => (s.plan ?? []).filter((p) => p.received).map((p) => p.amount);
    const planOf = (s: TenderSplit): UpiPart[] => {
        const a = payAccountById.get(s.paymentAccountId ?? -1);
        return upiPlan(s.amount, a?.mdr, opts.paymentMdr ? a?.split : null, !!s.oneGo, s.plan);
    };
    // The payments one checkout row is taken as.
    const partsOf = (s: TenderSplit): number[] => planOf(s).map((p) => p.amount);
    // Only its received parts kept — the rest re-planned (parts ⇄ one scan).
    const keepReceived = (s: TenderSplit): UpiPart[] => (s.plan ?? []).filter((p) => p.received);
    // Whether the row's method would take its rest in more than one part.
    const canSplit = (s: TenderSplit): boolean =>
        opts.paymentMdr === true && planOf({ ...s, oneGo: false, plan: keepReceived(s) }).filter((p) => !p.received).length > 1;
    // Bank charge a set of checkout rows costs (whole rupees). Cash never costs any.
    const mdrOf = (rows: TenderSplit[]): number => !mdrLines ? 0 : mdrRecovery(rows.flatMap((s) => {
        const rule = payAccountById.get(s.paymentAccountId ?? -1)?.mdr;
        return partsOf(s).map((amount) => ({ amount, rule }));
    }));

    // The whole bill for a given MDR recovery: line rows, tier, round-off, total.
    // Recovery 0 is today's bill exactly (the rebate alone moves the rows).
    // An edit whose items, points and shipping are as saved keeps its saved round-off,
    // so it comes to exactly what it did.
    const editSameBill = eb != null && editLinesUnchanged && redeemPts === eb.redeemedBefore && Math.abs(shippingAmt - eb.shippingAmt) < 0.005;
    const billFor = (recovery: number) => {
        const rates = mdrLines && recovery > 0 ? upliftedRates(mdrLines, recovery) : rebatedRates;
        const moved = rates.some((r, i) => r !== cart[i].unitPrice);
        // Lines that did not move ARE lineRows, and the tier stays untouched.
        const rows = !moved ? lineRows : cart.map((l, i) => {
            if (rates[i] === l.unitPrice) return lineRows[i];
            const { taxAmount, amount } = calcLineTotals({ quantity: l.qty, rate: rates[i], discountPct: 0, discountAmt: 0, taxRate: l.taxRate });
            return { amount, taxAmount, gross: l.qty * rates[i] };
        });
        // Tier discount re-measured on the moved rows (the server nets it per line
        // at the posted rate) — identical to effDiscountAmount when nothing moved.
        const tierDiscount = !moved ? effDiscountAmount : cart.reduce((sum, l, i) => {
            const net = calcLineTotals({ quantity: l.qty, rate: rates[i], discountPct: 0, discountAmt: round2(lineTierAfterCoupon[i]), taxRate: l.taxRate }).amount;
            return sum + (rows[i].amount - net);
        }, 0);
        // Auto round-off: lands Total on a whole rupee; a typed value wins.
        const natural = calcVoucherTotals(rows, shippingAmt, tierDiscount, 0, chargesNet).totalAmount;
        const ro = roundOffManuallyEdited ? parseAmt(roundOffStr) : editSameBill ? eb?.roundOff ?? 0 : Math.round(natural) - natural;
        // Single source of truth — matches /api/inventory/vouchers SALE math via
        // calcVoucherTotals, so server-side validation cannot disagree.
        const t = calcVoucherTotals(rows, shippingAmt, tierDiscount, ro, chargesNet).totalAmount;
        return { rows, moved, tierDiscount, natural, roundOff: ro, total: t };
    };
    // Outside checkout the bill is always the cash price — rows left from a
    // cancelled checkout must not move it. The sale sends this figure, and the
    // server checks it against its own (paymentMdr.ts on the same payments).
    const mdrRecoveryNow = checkoutOpen ? mdrOf(splits) : 0;
    const bill = billFor(mdrRecoveryNow);
    const billLineRows = bill.rows;
    const billTierDiscount = bill.tierDiscount;
    const billSubtotal = !bill.moved ? subtotal : billLineRows.reduce((sum, r) => sum + r.gross, 0);
    const billTax = !bill.moved ? tax : billLineRows.reduce((sum, r) => sum + r.taxAmount, 0);
    const naturalTotal = bill.natural;
    const autoRoundOff = Math.round(naturalTotal) - naturalTotal;
    const roundOff = bill.roundOff;
    const total = bill.total;

    // Tax-inclusive voucher total the customer pays — goods (incl. GST) + shipping
    // + charges − tier discount + round-off, BEFORE the money coupon / loyalty —
    // the min-bill qualifier for an independent FREE_ITEM / BOGO free item.
    // Mirrors /api/pos/sale's freeBillAmountIncl so the preview and the posted
    // grant agree (the free grant is independent, so it never uses its own ₹).
    const billAmountIncl = calcVoucherTotals(
        lineRows,
        shippingAmt,
        discountAmount,
        roundOff,
        manualChargesNet,
    ).totalAmount;

    // Gift card is a TENDER, not a discount — it doesn't change `total`, it covers
    // part of it. The cashier collects `payableTotal` in cash/UPI; the server draws
    // the same min(balance, total) from the card and posts it as a Dr-Liability tender.
    // An edit's card: what the sale drew plus what is still on it today.
    const giftFor = (t: number) => (eb
        ? (eb.gift ? Math.min(eb.gift.usedBefore + eb.gift.availableNow, t) : 0)
        : giftCard ? Math.min(giftCard.balance, t) : 0);
    const giftCardApplied = giftFor(total);
    const payableTotal = Math.max(0, +(total - giftCardApplied).toFixed(2));

    // The amount row `id` needs so the tenders settle the bill exactly, every
    // other row and `cash` as they stand. A row with a bank charge raises the
    // price it pays, so the rest of the bill moves with it — a few passes settle
    // it (the charge only grows with the amount, the total lands on whole
    // rupees). With no charge this is just bill − everything else.
    const coverAmount = (rows: TenderSplit[], id: string, cash: number): number => {
        const others = cash + rows.reduce((sum, x) => sum + (x.id === id ? 0 : x.amount), 0);
        const dueAt = (amount: number) => {
            const t = billFor(mdrOf(rows.map((x) => (x.id === id ? { ...x, amount } : x)))).total;
            return Math.max(0, round2(t - giftFor(t) - others));
        };
        let amount = dueAt(0);
        for (let pass = 0; pass < 5; pass++) {
            const next = dueAt(amount);
            if (Math.abs(next - amount) < 0.005) break;
            amount = next;
        }
        return amount;
    };
    const fillAmountFor = (s: TenderSplit) => Math.max(
        receivedOf(s).reduce((sum, p) => sum + p, 0),
        coverAmount(splits.map((x) => (x.id === s.id ? s : x)), s.id, Math.max(0, pay.cashTendered - pay.cashReturn)),
    );
    // Refresh the refs the early-bound shortcuts read (they bind above this block).
    useEffect(() => {
        payableTotalRef.current = payableTotal;
        coverAmountRef.current = coverAmount;
    });

    // What the whole bill comes to by each way of paying — the figures the
    // cashier reads out ("cash ₹5,000, card ₹5,102"). Only methods that cost
    // something (or split) are listed; the rest come to the cash figure.
    const methodTotals: { label: string; amount: number; note?: string }[] = [];
    if (mdrLines && cart.length > 0 && payAccounts.some((a) => (a.mdr?.ratePct ?? 0) > 0 || a.split?.enabled)) {
        const cashBill = billFor(0).total;
        methodTotals.push({ label: "Cash", amount: Math.max(0, round2(cashBill - giftFor(cashBill))) });
        const seen = new Set<string>();
        for (const a of payAccounts) {
            if (!((a.mdr?.ratePct ?? 0) > 0 || a.split?.enabled)) continue;
            const label = a.channel === "GATEWAY" ? a.label : CHANNEL_LABEL[a.channel];
            const key = `${label}|${JSON.stringify(a.mdr)}|${JSON.stringify(a.split)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const quote = (oneGo: boolean) => {
                const row: TenderSplit = { id: "quote", paymentAccountId: a.id, amount: 0, reference: "", oneGo };
                const amount = coverAmount([row], row.id, 0);
                return { amount, parts: partsOf({ ...row, amount }).length };
            };
            const split = quote(false);
            if (split.parts > 1) methodTotals.push({ label, amount: split.amount, note: `${split.parts} scans` });
            const one = quote(true);
            if (split.parts <= 1 || one.amount !== split.amount) {
                methodTotals.push({ label, amount: one.amount, note: split.parts > 1 ? "one scan" : undefined });
            }
        }
    }

    // Bill-level adjustments shown on the customer ladder (print + display) so the
    // breakdown reconciles: manual charges + shipping + round-off (signed). Loyalty
    // /coupon are passed as their own discount fields, not here.
    const posExtraCharges: { label: string; amount: number; taxAmount?: number }[] = [
        ...charges
            .filter((c) => c.accountId !== null && Math.abs(parseAmt(c.amount)) >= 0.005)
            .map((c) => ({ label: c.description?.trim() || "Charge", amount: parseAmt(c.amount) })),
        ...(shippingAmt > 0.005 ? [{ label: "Shipping", amount: shippingAmt, taxAmount: shippingTaxAmt }] : []),
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
            if (data.ok) {
                setGiftCard({ id: data.id, code: data.code, balance: data.balance });
                toast.success(`Gift card ${data.code} · ${formatInr(data.balance)} available`);
                // Done with the bill-summary section — hand focus back to the scan box.
                focusWhenReady(() => productSearchRef.current);
            }
            else { setGiftCard(null); toast.error(data.reason ?? "Gift card not usable"); }
        } catch {
            toast.error("Gift-card lookup failed");
        } finally {
            setGcBusy(false);
        }
    }

    // ── Coupon apply + auto-revalidation ──────────────────────────────────────
    // The server owns the ₹ value. Everything the coupon routes judge this bill
    // by is built here, once, and the re-validation signature IS that payload —
    // so any change the server would see re-checks the coupon (checkout
    // re-validates too — the server is the final authority). A hand-picked
    // signature used to leave out billAmountIncl, so changing shipping, a charge
    // or the round-off never re-checked a free grant's minimum bill.
    // No coupon checks on an edit — it keeps the coupon its sale used.
    const couponBill = useMemo(() => snapshot?.account && !eb ? {
        accountId: snapshot.account.id,
        isNewCustomer: snapshot.turnover.invoiceCount === 0,
        tierRupees: discountAmount,
        loyaltyRupees: redemptionRupees,
        // Free-grant min-bill qualifies on the full voucher total (all +/− in).
        billAmountIncl,
        // taxRate rides along so the server can gross up its resolved cost to
        // cost-incl-tax — the LINE-scope tier-share estimate base. Service
        // lines are excluded — coupons evaluate the goods cart only (mirrors
        // /api/pos/sale).
        lines: cart.filter((l) => l.kind !== "service").map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    } : null, [snapshot?.account, snapshot?.turnover.invoiceCount, discountAmount, redemptionRupees, billAmountIncl, cart, eb]);
    const couponSig = JSON.stringify(couponBill);
    // Coupon identity for re-validation: AUTO offers carry no code, so the key
    // is the coupon id — a typed code keeps its code (and shows on the bill).
    const appliedCouponKey = appliedCoupon ? `${appliedCoupon.couponId}:${appliedCoupon.code ?? ""}` : null;
    const appliedFreeKey = appliedFree ? `${appliedFree.couponId}:${appliedFree.code ?? ""}` : null;
    type ValidateResp = { ok: boolean; reason?: string; couponId: number; code: string | null; name: string; discountRupees: number; droppedTier: boolean; blockedLoyalty: boolean; freeLines?: { productId: number; freeQty: number; productName: string }[]; onTop?: boolean; moneyGrant?: boolean };
    async function runValidate(validateOpts: { code?: string; freeCode?: string; couponId?: number; freeCouponId?: number; autoApply?: boolean; freeAutoApply?: boolean }): Promise<ValidateResp | null> {
        if (!couponBill) return null;
        const { data } = await axios.post<ValidateResp>("/api/pos/coupon-validate", {
            ...couponBill,
            code: validateOpts.code,
            freeCode: validateOpts.freeCode,
            couponId: validateOpts.couponId,
            freeCouponId: validateOpts.freeCouponId,
            autoApply: validateOpts.autoApply,
            freeAutoApply: validateOpts.freeAutoApply,
        });
        return data;
    }
    const hit = (d: ValidateResp): CouponHit => ({ couponId: d.couponId, code: d.code, name: d.name, rupees: d.discountRupees, droppedTier: d.droppedTier, blockedLoyalty: d.blockedLoyalty });

    // Re-validate the applied coupon whenever the bill the server judges changes
    // (couponSig) — by code when it has one, by id for a force-applied AUTO offer.
    useEffect(() => {
        if (!appliedCoupon || !snapshot?.account) return;
        let cancelled = false;
        runValidate(appliedCoupon.code ? { code: appliedCoupon.code } : { couponId: appliedCoupon.couponId })
            .then((data) => {
                if (cancelled || !data) return;
                if (data.ok) setAppliedCoupon((prev) => (prev ? { ...prev, rupees: data.discountRupees, droppedTier: data.droppedTier, blockedLoyalty: data.blockedLoyalty, freeLines: data.freeLines } : prev));
                else { setAppliedCoupon(null); toast.message("Coupon removed — no longer applies to this cart"); }
            })
            .catch(() => { /* keep prior value; checkout re-validates */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on couponSig (the bill's content) and the coupon key, not on object identity
    }, [couponSig, appliedCouponKey, snapshot?.account?.id]);

    // Auto-apply: when there's no manual coupon, surface the best eligible AUTO
    // offer. The server re-applies it at checkout via the autoApply flag. The
    // moment it stops applying it is cleared, while rendering.
    const autoCouponApplies = appliedCoupon == null && !!snapshot?.account && cart.length > 0;
    if (useValueChange(autoCouponApplies) && !autoCouponApplies) setAutoCoupon(null);
    useEffect(() => {
        if (!autoCouponApplies) return;
        let cancelled = false;
        runValidate({ autoApply: true })
            .then((data) => { if (!cancelled) setAutoCoupon(data?.ok ? { ...hit(data), freeLines: data.freeLines } : null); })
            .catch(() => { if (!cancelled) setAutoCoupon(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on couponSig (the bill's content) and the coupon key, not on object identity
    }, [couponSig, appliedCouponKey, snapshot?.account?.id, cart.length]);

    // Re-validate the applied FREE-GRANT coupon when the cart changes — its
    // BOGO buy side can drop out of range (then the free items are no longer
    // due). The server owns the grant; this only refreshes the badge lines.
    useEffect(() => {
        if (!appliedFree || !snapshot?.account) return;
        let cancelled = false;
        runValidate(appliedFree.code ? { freeCode: appliedFree.code } : { couponId: appliedFree.couponId })
            .then((data) => {
                if (cancelled || !data) return;
                const fl = data.freeLines;
                if (data.ok && (fl?.length || data.onTop)) {
                    setAppliedFree((prev) => (prev
                        ? { ...prev, freeLines: fl ?? [], onTop: data.onTop, rupees: data.onTop ? data.discountRupees : prev.rupees }
                        : prev));
                } else {
                    clearFreeCoupon();
                    toast.message("Free offer removed — no longer applies to this cart");
                }
            })
            .catch(() => { /* keep prior value; checkout re-validates */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on couponSig (the bill's content) and the coupon key, not on object identity
    }, [couponSig, appliedFreeKey, snapshot?.account?.id]);

    // Auto free-grant: surface the best eligible independent AUTO FREE_ITEM /
    // BOGO offer as FREE rows in the item list (the free-grant analogue of the
    // autoCoupon effect above). A manually applied free offer wins over the
    // automatic pick; the server re-selects the grant at checkout anyway.
    const autoFreeApplies = appliedFree == null && !!snapshot?.account && cart.length > 0;
    if (useValueChange(autoFreeApplies) && !autoFreeApplies) setAutoFree(null);
    useEffect(() => {
        if (!autoFreeApplies) return;
        let cancelled = false;
        runValidate({ freeAutoApply: true })
            .then((data) => {
                if (cancelled) return;
                setAutoFree(data?.ok && (data.freeLines?.length || data.onTop)
                    ? {
                        couponId: data.couponId, code: data.code, name: data.name,
                        freeLines: data.freeLines ?? [], onTop: data.onTop, rupees: data.onTop ? data.discountRupees : undefined,
                    }
                    : null);
            })
            .catch(() => { if (!cancelled) setAutoFree(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on couponSig (the bill's content) and the coupon key, not on object identity
    }, [couponSig, appliedFreeKey, snapshot?.account?.id, cart.length]);

    // Offers panel — refresh on the same beat as coupon re-validation, debounced
    // so fast scanning doesn't hammer the route. The server owns every gate;
    // this only renders what it returns.
    if (useValueChange(couponBill == null) && couponBill == null) setOffers(null);
    useEffect(() => {
        if (!couponBill) return;
        // The same bill the coupon checks read, so the panel can never disagree.
        const { accountId, isNewCustomer, billAmountIncl: billIncl, lines } = couponBill;
        let cancelled = false;
        const t = setTimeout(() => {
            axios.post<{ offers: PosOffer[]; crossSell: ProductOption[] }>("/api/pos/coupon-offers", {
                accountId,
                isNewCustomer,
                billAmountIncl: billIncl,
                lines,
            })
                .then((r) => { if (!cancelled) { setOffers(r.data.offers); setCrossSell(r.data.crossSell); } })
                .catch(() => { if (!cancelled) { setOffers(null); setCrossSell([]); } });
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on couponSig (the bill's content) and the coupon key, not on object identity
    }, [couponSig, snapshot?.account?.id]);

    // Apply an independent free-grant coupon — store it + surface the free items.
    // The server re-derives the free lines at checkout from `freeCouponCode`, so
    // this is purely display + the code the payload carries.
    function applyFreeGrant(data: ValidateResp) {
        const fl = data.freeLines;
        if (!fl?.length) return false;
        setAppliedFree({
            couponId: data.couponId, code: data.code, name: data.name, freeLines: fl,
        });
        toast.success(`Free items on this bill: ${fl.map((f) => `${f.freeQty} × ${f.productName}`).join(", ")}`);
        focusWhenReady(() => productSearchRef.current);
        return true;
    }
    function clearFreeCoupon() {
        setAppliedFree(null);
    }
    async function applyFreeCoupon(codeArg?: string) {
        const code = (codeArg ?? "").trim().toUpperCase();
        if (!code || !snapshot?.account) return;
        setFreeBusy(true);
        try {
            const data = await runValidate({ freeCode: code });
            if (data?.ok && data.onTop) {
                // Rule 2 — independent PARTIAL code in the free box: an on-top
                // ₹ discount (never clears the money coupon).
                setAppliedFree({ couponId: data.couponId, code: data.code, name: data.name, freeLines: [], onTop: true, rupees: data.discountRupees });
                toast.success(`${data.code ?? data.name} · − ${formatInr(data.discountRupees)} on top`);
            } else if (data?.ok && data.freeLines?.length) {
                applyFreeGrant(data);
            } else {
                clearFreeCoupon();
                toast.error(data?.reason ?? "Free offer not applicable");
            }
        } catch {
            toast.error("Free offer check failed");
        } finally {
            setFreeBusy(false);
        }
    }

    async function applyCoupon(codeArg?: string) {
        const code = (codeArg ?? couponCodeStr).trim().toUpperCase();
        if (!code || !snapshot?.account) return;
        setCouponBusy(true);
        try {
            const data = await runValidate({ code });
            if (data?.ok) {
                if (data.onTop) {
                    // Rule 2 — an independent PARTIAL code (FREE_ITEM / BOGO,
                    // <100%): a ₹ discount ON TOP of the money coupon — never
                    // clears it, never drops tier / blocks loyalty.
                    setAppliedFree({ couponId: data.couponId, code: data.code, name: data.name, freeLines: [], onTop: true, rupees: data.discountRupees });
                    toast.success(`${data.code ?? data.name} applied · − ${formatInr(data.discountRupees)} on top`);
                    focusWhenReady(() => productSearchRef.current);
                } else if (data.moneyGrant && data.freeLines?.length) {
                    // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO won
                    // the MONEY slot: free lines REPLACE the ₹ coupon (it is a
                    // money coupon — exclusivity applies server-side).
                    setAppliedCoupon({ couponId: data.couponId, code: data.code, name: data.name, rupees: 0, droppedTier: false, blockedLoyalty: false, freeLines: data.freeLines });
                    toast.success(`${data.code ?? data.name} — ${data.freeLines.map((f) => `${f.freeQty} × ${f.productName}`).join(", ")} FREE`);
                    focusWhenReady(() => productSearchRef.current);
                } else if (data.freeLines?.length) {
                    // An independent free-grant code (FREE_ITEM / BOGO) — it isn't
                    // a ₹ discount; apply it as free items ON TOP of the money
                    // coupon (independent by design — never clear the ₹ coupon).
                    applyFreeGrant(data);
                } else {
                    setAppliedCoupon(hit(data));
                    toast.success(`Coupon ${data.code ?? data.name} applied · − ${formatInr(data.discountRupees)}`);
                    // Done with the coupon section — hand focus back to the scan box.
                    focusWhenReady(() => productSearchRef.current);
                }
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

    // One-click apply from the Offers panel — same path as typing the code.
    const applyOffer = (code: string) => {
        setCouponCodeStr(code);
        void applyCoupon(code);
    };

    // Force-apply a SPECIFIC AUTO offer by id (AUTO coupons have no code to
    // type) — the offers card's Apply button. The server resolves the coupon: a
    // free-grant offer lands in the free slot, a money offer in the ₹ slot.
    async function applyOfferById(couponId: number) {
        if (!snapshot?.account) return;
        try {
            const data = await runValidate({ couponId });
            if (data?.ok && data.onTop) {
                // Rule 2 — an independent PARTIAL offer: on-top ₹ (never
                // replaces the money coupon).
                setAppliedFree({ couponId: data.couponId, code: data.code, name: data.name, freeLines: [], onTop: true, rupees: data.discountRupees });
                toast.success(`${data.name} · − ${formatInr(data.discountRupees)} on top`);
            } else if (data?.ok && data.moneyGrant && data.freeLines?.length) {
                // Rule 3 — a non-independent fully-free offer won the money slot.
                setAppliedCoupon({ couponId: data.couponId, code: data.code, name: data.name, rupees: 0, droppedTier: false, blockedLoyalty: false, freeLines: data.freeLines });
                toast.success(`${data.name} — ${data.freeLines.map((f) => `${f.freeQty} × ${f.productName}`).join(", ")} FREE`);
            } else if (data?.ok && data.freeLines?.length) {
                // Independent free-grant offer — rides on top of the money
                // coupon (never replaces it).
                applyFreeGrant(data);
            } else if (data?.ok) {
                setAppliedCoupon(hit(data));
                setCouponCodeStr("");
                toast.success(`Offer ${data.name} applied · − ${formatInr(data.discountRupees)}`);
                focusWhenReady(() => productSearchRef.current);
            } else {
                setAppliedCoupon(null);
                toast.error(data?.reason ?? "Offer not applicable");
            }
        } catch {
            toast.error("Offer check failed");
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    const fetchSnapshot = useCallback(async (accountId: number) => {
        setLoadingSnapshot(true);
        // Once a party is picked the search is locked; shift focus to the product
        // search so the cashier can scan/type immediately.
        focusWhenReady(() => productSearchRef.current);
        try {
            const { data } = await axios.get<Snapshot>(`/api/pos/account-snapshot/${accountId}`);
            setSnapshot(data);
        } catch {
            toast.error("Could not load customer details");
            setSnapshot(null);
        } finally {
            setLoadingSnapshot(false);
        }
    }, [productSearchRef, setSnapshot]);

    // Re-sync effective sale prices once, when a sale starts. A counter can sit
    // idle for hours; prices may have been re-frozen elsewhere meanwhile. This
    // hits the lightweight prices-only endpoint (no GST/cost cascade) and patches
    // the in-memory list by id — cart lines stay snapshotted, so it never shifts
    // a sale in progress. Failure is silent: keep the prices we already have.
    const refreshPrices = useCallback(async () => {
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
    }, [setAllProducts]);

    const onPartyPicked = useCallback((p: PickedParty) => {
        // If we were in change-customer mode, picking any party exits it.
        if (changingPartyRef.current) {
            setChangingParty(false);
            originalPartyRef.current = null;
        }
        // Manually choosing a customer means this is no longer the preloaded
        // repair-ticket bill — drop the ticket link so we don't mis-attribute it.
        setTicketId(null);
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        void refreshPrices();          // billing starts — pull prices re-frozen while idle
        void fetchSnapshot(p.accountId);
    }, [refreshPrices, fetchSnapshot, setTicketId]);

    const clearCustomer = () => {
        setSnapshot(null);
        setTicketId(null);
        partySearchRef.current?.clear();
        partySearchRef.current?.focus();
    };

    // Esc during change mode → restore the original party and re-lock the picker.
    // Wired here (after onPartyPicked) so the callback is in scope.
     
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (!changingPartyRef.current || !originalPartyRef.current) return;
            e.preventDefault();
            onPartyPicked(originalPartyRef.current);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onPartyPicked, changingPartyRef, originalPartyRef]);

    // ── Cart actions ────────────────────────────────────────────────────────
    const addToCart = (p: ProductOption) => {
        // Last-scanned line becomes the selected one ("+" / "-" target).
        setCartSelectedId(p.id);
        // Product's effectiveSalePricePaise is treated as TAX-INCLUSIVE (matches
        // the price tag / MRP-style retail expectations). We back-calculate the
        // pre-tax rate here so the rest of the math (calcLineTotals) — which
        // expects an exclusive rate — produces the right breakdown.
        // A customer group may bill this product group at MRP or the printed
        // barcode price instead (Pricing Strategy → Group pricing).
        const startPaise = groupStartPricePaise(ruleForGroup(snapshot?.groupPricing, p.groupId), {
            salePaise: p.effectiveSalePricePaise, tagPaise: p.barcodePricePaise, mrpPaise: p.mrpPaise,
        });
        const inclusivePrice = startPaise ? startPaise / 100 : 0;
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
                salePaise: p.effectiveSalePricePaise ?? null,
                groupId: p.groupId ?? null,
                autoPrice: true,
                warrantyLabel,
                requireSaleNote: p.requireSaleNote ?? false,
                redeemCapPct: p.redeemCapPct ?? null,
                // Discount-protection blacklist flag — no tier / loyalty / coupon
                // on this line (mirrors the server's own blacklist read).
                protected: p.protected ?? false,
            }];
        });
        setProductQuery("");
        // Clear highlight + return focus to the search box so cashier can scan next item
        setProductHighlight(0);
        focusWhenReady(() => productSearchRef.current);
    };

    // Add a service (Settings → Services) to the cart as a GL-only line
    // (kind="service"): its default price is TAX-INCLUSIVE, so back-calculate the
    // pre-tax rate exactly like a product. No barcode / cost / MRP / stock. The
    // line id is −serviceId so it never collides with a product id, and the same
    // productId-keyed qty/price setters work unchanged.
    const addServiceToCart = (svc: PosServiceOption) => {
        const inclusive = svc.defaultPricePaise ? svc.defaultPricePaise / 100 : 0;
        const rate = svc.taxRate ?? 0;
        const price = rate > 0 ? inclusive / (1 + rate / 100) : inclusive;
        const lineId = -svc.id;
        setCartSelectedId(lineId);
        setCart((prev) => {
            const exist = prev.find((l) => l.productId === lineId);
            if (exist) return prev.map((l) => l.productId === lineId ? { ...l, qty: l.qty + 1 } : l);
            return [...prev, {
                productId: lineId, sku: "SVC", name: svc.name, kind: "service" as const,
                qty: 1, unitPrice: price, description: "",
                taxRate: rate,
            }];
        });
        focusWhenReady(() => productSearchRef.current);
    };

    const setQty = useCallback((productId: number, qty: number) => {
        if (qty <= 0) {
            setCart((p) => p.filter((l) => l.productId !== productId));
            // The removed line may have been the selection — hand the highlight
            // to the line that took its place (or the new last line).
            if (cartSelectedId === productId) {
                const idx = cart.findIndex((l) => l.productId === productId);
                const rest = cart.filter((l) => l.productId !== productId);
                setCartSelectedId(rest[Math.min(idx, rest.length - 1)]?.productId ?? null);
            }
            return;
        }
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, qty } : l));
    }, [setCart, setCartSelectedId, cart, cartSelectedId]);

    // A typed price is the cashier's call — the line stops following the
    // customer's group pricing (see the re-price effect below).
    const setPrice = (productId: number, unitPrice: number) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, unitPrice, autoPrice: false } : l));

    // Customer picked / changed / cleared → re-price the lines the POS priced
    // itself by the new customer's group rule (MRP / print price / normal
    // sale price). Typed prices, services and hydrated edit / converted lines
    // (no autoPrice) stay as they are. Only writes when a price really moves.
    const groupPricingSig = JSON.stringify(snapshot?.groupPricing ?? null);
    useEffect(() => {
        const pricing = snapshot?.groupPricing ?? null;
        setCart((prev) => {
            let moved = false;
            const next = prev.map((l) => {
                if (!l.autoPrice || l.kind === "service") return l;
                const startPaise = groupStartPricePaise(ruleForGroup(pricing, l.groupId), {
                    salePaise: l.salePaise, tagPaise: l.barcodePaise, mrpPaise: l.mrpPaise,
                });
                if (startPaise == null) return l;
                const incl = startPaise / 100;
                const unitPrice = l.taxRate > 0 ? incl / (1 + l.taxRate / 100) : incl;
                if (Math.abs(unitPrice - l.unitPrice) < 1e-9) return l;
                moved = true;
                return { ...l, unitPrice };
            });
            return moved ? next : prev;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the rules' content, not the snapshot object
    }, [groupPricingSig, setCart]);

    const setLineDescription = (productId: number, description: string) =>
        setCart((p) => p.map((l) => l.productId === productId ? { ...l, description } : l));

    // "+" / "-" from anywhere → step the SELECTED line by one qty (ECR
    // heritage: PLUS adds, MINUS subtracts). The last item added is selected
    // by default; ArrowUp/Down or a click moves the selection. Skipped while
    // typing in a field or when a dialog is open; ctrl/meta/alt combos are
    // browser/OS territory. Main-row "+" arrives with shiftKey (Shift+=), so
    // shift is NOT a skip.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "+" && e.key !== "-") return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (createDialogOpen || checkoutOpen) return;
            const active = document.activeElement as HTMLElement | null;
            const inSearchBox = active === productSearchRef.current;
            // Mid-query in the search box → "+"/"-" are normal characters
            // (e.g. searching "T-Shirt"). Empty search box (the post-scan
            // state) → act on the selection instead of opening the dropdown
            // with a "+"/"-" query.
            if (inSearchBox && productQuery.trim()) return;
            // Any other field → let the character type normally.
            if (!inSearchBox && (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable)) return;
            e.preventDefault();
            const line = (cartSelectedId != null ? cart.find((l) => l.productId === cartSelectedId) : null) ?? cart[cart.length - 1];
            if (!line) return;
            if (e.key === "+") setQty(line.productId, line.qty + 1);
            else setQty(line.productId, line.qty - 1); // ≤ 0 removes the line
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [cart, cartSelectedId, productQuery, createDialogOpen, checkoutOpen, setQty, productSearchRef]);

    // Rendered cart order — products first, then services — identical to the
    // shell's display sort, so ArrowUp/Down move the highlight exactly the way
    // the cashier sees the list (a service added before a product would
    // otherwise jump confusingly in array order).
    const renderCart = useMemo(
        () => [...cart.filter((l) => l.kind !== "service"), ...cart.filter((l) => l.kind === "service")],
        [cart],
    );

    // ArrowUp / ArrowDown → move the cart-line selection. Skipped while the
    // product dropdown is open (arrows there navigate the dropdown), while
    // typing in a field (except the empty search box), or when a dialog is open.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (createDialogOpen || checkoutOpen) return;
            const active = document.activeElement as HTMLElement | null;
            const inSearchBox = active === productSearchRef.current;
            if (inSearchBox && productQuery.trim()) return; // dropdown nav owns it
            if (!inSearchBox && (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable)) return;
            if (cart.length === 0) return;
            e.preventDefault();
            const order = renderCart.map((l) => l.productId);
            const idx = cartSelectedId != null ? order.indexOf(cartSelectedId) : -1;
            const current = idx >= 0 ? idx : order.length - 1;
            const next = e.key === "ArrowDown" ? Math.min(current + 1, order.length - 1) : Math.max(current - 1, 0);
            setCartSelectedId(order[next]);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [renderCart, cart, cartSelectedId, productQuery, createDialogOpen, checkoutOpen, productSearchRef]);

    // ── Product dropdown keyboard nav ──────────────────────────────────────
    const onProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filteredProducts.length > 0) {
                setProductHighlight((i) => Math.min(i + 1, filteredProducts.length - 1));
                setHighlightTouched(true);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filteredProducts.length > 0) {
                setProductHighlight((i) => Math.max(i - 1, 0));
                setHighlightTouched(true);
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            // A scan that found nothing still ends in Enter. Never let that
            // land a "nearest guess" on the bill by itself — the cashier has
            // to aim at the row first (arrow keys or click).
            const pick = filteredProducts[productHighlight] ?? filteredProducts[0];
            if (pick && productGuessIds.has(pick.id) && !highlightTouched) {
                toast.error("No exact match — pick an item from the list");
                return;
            }
            if (pick) addToCart(pick);
        } else if (e.key === "Escape") {
            if (productQuery.trim()) {
                setProductQuery("");
            } else {
                // Already empty — blur so F2 / / shortcuts become available.
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
            }
        }
    };

    // Opens the checkout. `prefill` seeds the FULL payable amount on ONE tender:
    //   { tender: "split" } → option-2 — the first default-visible payment-account
    //                         row (normally UPI these days); falls back to cash
    //                         when the counter has no such row.
    //   { tender: "cash" }  → option-1 — the Cash row.
    // A normal open starts at ₹0 and lets the cashier type the tendered amount.
    const openCheckout = useCallback((prefill?: { tender: "cash" | "split" }) => {
        if (!snapshot?.account) { toast.error("Pick a customer first"); return; }
        if (cart.length === 0) { toast.error("Cart is empty"); return; }
        if (cart.some((l) => l.unitPrice <= 0)) { toast.error("All lines need a unit price"); return; }
        // Pre-show the accounts flagged "default visible" as rows; the rest stay
        // behind "Add payment line".
        const visible = payAccounts.filter((a) => a.defaultVisible);
        // An edit opens on the payment the sale was saved with, so the cashier
        // changes only what was wrong (UPI → Cash); the other rows still show.
        const saved = !prefill ? eb?.savedPayments : undefined;
        const splits = [
            ...(saved?.splits ?? []).map((r) => ({ id: crypto.randomUUID(), ...r })),
            ...visible
                .filter((a) => !saved?.splits.some((r) => r.paymentAccountId === a.id))
                .map((a) => ({ id: crypto.randomUUID(), paymentAccountId: a.id, amount: 0, reference: "" })),
        ];
        // Quick-pay prefill: the whole bill lands on one tender (payableTotal =
        // total − gift card). F10 → option-2 (first account row, usually UPI);
        // a counter with no default-visible non-cash row falls back to option-1
        // (cash), as does the explicit cash prefill.
        // The amount is solved for the fresh rows (a card row raises the price it
        // pays — see coverAmount); with no bank charge it is the payable total.
        let cashTendered = saved?.cash ?? 0;
        if (prefill?.tender === "split" && splits.length > 0) {
            splits[0] = { ...splits[0], amount: coverAmountRef.current(splits, splits[0].id, 0) };
        } else if (prefill?.tender === "cash" || (prefill?.tender === "split" && splits.length === 0)) {
            cashTendered = coverAmountRef.current([], "", 0);
        }
        setPay({ cashTendered, cashReturn: 0 });
        setSplits(splits);
        setCheckoutOpen(true);
        focusWhenReady(() => cashTenderedRef.current);
    }, [snapshot, cart, payAccounts, coverAmountRef, cashTenderedRef, eb]);

    // F10 → quick pay on option-2: opens checkout with the full payable amount
    // (total − gift card, no change) seeded on the FIRST payment-account row —
    // normally UPI these days — instead of cash. One key for "take the money
    // and go" on today's default payment. With checkout already open, F10 moves
    // the whole bill onto option-2 — the toggle partner of "/" (cash full).
    // Function key, so it overrides the current context like F2; goes through
    // openCheckout so the same guards + toasts fire.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "F10") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (createDialogOpen) return;
            e.preventDefault();
            if (checkoutOpen) {
                // All on option-2 (first account row, usually UPI); adds the
                // row when the counter has accounts but none was pre-shown.
                // UPI parts already coming in → leave the payment rows alone.
                if (splits.some((s) => receivedOf(s).length > 0)) return;
                setPay({ cashTendered: 0, cashReturn: 0 });
                setSplits((prev) => {
                    const rows = prev.length > 0
                        ? prev.map((s) => ({ ...s, amount: 0 }))
                        : payAccounts.length > 0
                            ? [{ id: crypto.randomUUID(), paymentAccountId: payAccounts[0].id, amount: 0, reference: "" }]
                            : null;
                    if (!rows) return prev; // cash-only counter
                    const first = rows[0];
                    return rows.map((s) => (s.id === first.id ? { ...s, amount: coverAmountRef.current(rows, first.id, 0) } : s));
                });
                return;
            }
            openCheckout({ tender: "split" });
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [createDialogOpen, checkoutOpen, openCheckout, splits, coverAmountRef, payAccounts, setPay, setSplits]);

    // F9 → quick cash: opens checkout with the full payable amount seeded on
    // the CASH row (option-1) — the one-key "customer pays cash" flow. Kept
    // separate from F10 (quick pay on option-2 / UPI) so one key covers each
    // payment type. Function key, so it overrides the current context like F2;
    // goes through openCheckout so the same guards + toasts fire. Inside the
    // open checkout, "/" fills cash with the rest instead.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "F9") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (createDialogOpen || checkoutOpen) return;
            e.preventDefault();
            openCheckout({ tender: "cash" });
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [createDialogOpen, checkoutOpen, openCheckout]);

    // F1 → counter help: open the POS help & shortcuts page in a new tab — the
    // same page the rail "?" button opens. preventDefault stops the browser's
    // own F1 help. Function key, so it works from any context like F2; skipped
    // while a dialog is open.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "F1") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (createDialogOpen || checkoutOpen) return;
            e.preventDefault();
            // New tab; if the popup is blocked (kiosk / embedded browser), fall
            // back to in-app navigation so the guide still opens.
            if (!openPosHelpTab()) router.push(POS_HELP_URL);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [createDialogOpen, checkoutOpen, router]);

    // Shift+Esc → clear the whole bill mid-way: opens a confirmation dialog
    // (Esc / Cancel aborts, Clear confirms). Esc alone keeps its existing role
    // (clear search query → dismiss dropdown → blur); Shift+Esc is the "clear
    // everything" escalator. Blocked while any modal is open and when the
    // cart is empty.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || !e.shiftKey) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (createDialogOpen || checkoutOpen || shareOpen || adjustmentsOpen
                || returnDialogOpen || expenditureDialogOpen || receiptDialogOpen
                || shiftOpenDialogOpen || shiftDropOpen || shiftCloseOpen) return;
            if (cart.length === 0) return;
            e.preventDefault();
            setClearCartDialogOpen(true);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [createDialogOpen, checkoutOpen, shareOpen, adjustmentsOpen, returnDialogOpen,
        expenditureDialogOpen, receiptDialogOpen, shiftOpenDialogOpen, shiftDropOpen,
        shiftCloseOpen, cart.length, setClearCartDialogOpen]);

    // ↑ / ↓ inside the open checkout → move focus to the NEXT / PREVIOUS
    // payment line's amount box — the keyboard replacement for Tab across the
    // tender list (Cash → payment line 1 → payment line 2 → …). From the Cash
    // row ↓ jumps to the first line's amount; ↓ again to the next line; ↑ steps
    // back. When focus sits on an in-between field (cash return, a line's ref
    // box), the arrow steps to the nearest line amount in that direction.
    // Buttons (account dropdown, Share) keep native arrow behavior (Radix opens
    // the menu), as do arrows inside the open dropdown (Radix handles + prevents
    // default there, so this sees defaultPrevented and stays out of the way).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            if (!checkoutOpen) return;
            if (e.defaultPrevented) return;
            const active = document.activeElement as HTMLElement | null;
            if (!active || active.tagName === "BUTTON") return;
            e.preventDefault();
            const dir = e.key === "ArrowDown" ? 1 : -1;
            // All tender inputs in DOM order; `data-tender-amount` marks the
            // per-line landing spots (Cash tendered, then each split amount).
            const fields = Array.from(document.querySelectorAll<HTMLInputElement>("[data-tender-field]"));
            if (fields.length === 0) return;
            const amounts = fields.filter((f) => f.hasAttribute("data-tender-amount"));
            let next: HTMLInputElement | null = null;
            const idx = fields.indexOf(active as HTMLInputElement);
            if (idx >= 0) {
                let j = idx + dir;
                while (j >= 0 && j < fields.length) {
                    if (fields[j].hasAttribute("data-tender-amount")) { next = fields[j]; break; }
                    j += dir;
                }
            } else {
                // Focus elsewhere in the dialog — jump to the first (↓) / last (↑) line.
                next = dir === 1 ? (amounts[0] ?? null) : (amounts[amounts.length - 1] ?? null);
            }
            if (!next) return;
            next.focus();
            next.select();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [checkoutOpen]);

    // Clear the whole bill mid-way (Shift+Esc → confirm dialog). Cart, tenders,
    // coupon / loyalty / gift card and adjustments all reset AND the customer is
    // dropped — the cashier is starting fresh with a DIFFERENT customer (unlike
    // resetAfterSubmit, which keeps the party for a quick re-bill). Focus
    // returns to the scan box.
    const clearBill = () => {
        setCart([]);
        setPay({ cashTendered: 0, cashReturn: 0 });
        setSplits([]);
        setShippingAmtStr("");
        setRedeemPointsStr("");
        setRedeemOn(false);
        setCouponCodeStr("");
        setAppliedCoupon(null);
        setAutoCoupon(null);
        setAppliedFree(null);
        setAutoFree(null);
        setGiftCardCodeStr("");
        setGiftCard(null);
        setRoundOffStr("");
        setRoundOffManuallyEdited(false);
        setCharges([]);
        setCartSelectedId(null);
        setTicketId(null);
        setConvertFrom(null);   // emptied or saved — the ⇄ conversion is over
        setAdjustmentsOpen(false);
        setCheckoutOpen(false);
        setClearCartDialogOpen(false);
        // Drop the customer too — ready to pick a new one.
        setSnapshot(null);
        partySearchRef.current?.clear();
        toast.message("Bill and customer cleared");
        focusWhenReady(() => productSearchRef.current);
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
        setAppliedFree(null);
        setAutoFree(null);
        setGiftCardCodeStr("");
        setGiftCard(null);
        setRoundOffStr("");
        setRoundOffManuallyEdited(false);
        setCharges([]);
        setCartSelectedId(null);
        setTicketId(null);
        setConvertFrom(null);   // emptied or saved — the ⇄ conversion is over
        setAdjustmentsOpen(false);
        setCheckoutOpen(false);
        // Auto-clear customer after successful bill so the next sale starts fresh.
        setSnapshot(null);
        partySearchRef.current?.clear();
        focusWhenReady(() => productSearchRef.current);
    };

    // Money math derived from pay — Cash net = tendered − return.
    const cashNet = Math.max(0, pay.cashTendered - pay.cashReturn);
    const splitsSum = splits.reduce((s, x) => s + x.amount, 0);
    // A UPI row is TRACKED once it is taken in parts or any part of it is in:
    // every payment of it is then ticked as received.
    const isUpiRow = (x: TenderSplit) => payAccountById.get(x.paymentAccountId ?? -1)?.channel === "UPI";
    const isTracked = (x: TenderSplit) => receivedOf(x).length > 0 || partsOf(x).length > 1;
    // The part being received now — the one the cashier picked, else the first
    // still to come in. −1 when every part is in.
    const activeOf = (x: TenderSplit, plan: UpiPart[] = planOf(x)): number =>
        x.activePart != null && plan[x.activePart] && !plan[x.activePart].received
            ? x.activePart
            : plan.findIndex((p) => !p.received);
    // The part on the customer display — the first tracked UPI row's active part;
    // the display shows only its QR, one part at a time.
    const upiPart = (() => {
        for (const x of splits) {
            if (!isUpiRow(x) || !isTracked(x)) continue;
            const plan = planOf(x);
            const i = activeOf(x, plan);
            if (i >= 0) {
                return { amount: plan[i].amount, index: i + 1, count: plan.length, vpa: payAccountById.get(x.paymentAccountId ?? -1)?.vpa ?? null };
            }
        }
        return null;
    })();
    // UPI parts not all ticked as received yet — Confirm waits for them.
    const upiPartsPending = splits.some((x) => isTracked(x) && planOf(x).some((p) => !p.received));

    // The "UPI in parts" panel beside the checkout (UpiPartsPanel) — for the
    // first UPI row that is tracked, or that one scan would take above the free
    // limit (so the cashier can still choose parts). New sale only.
    const upiPanel: UpiPanelState | null = (() => {
        if (!opts.paymentMdr || !checkoutOpen) return null;
        const cash = Math.max(0, pay.cashTendered - pay.cashReturn);
        for (const x of splits) {
            if (!isUpiRow(x) || x.amount <= 0) continue;
            if (!isTracked(x) && !(x.oneGo && canSplit(x))) continue;
            const plan = planOf(x);
            const amountAs = (oneGo: boolean) => Math.max(
                receivedOf(x).reduce((sum, p) => sum + p, 0),
                coverAmount(splits.map((y) => (y.id === x.id ? { ...y, oneGo, plan: keepReceived(y) } : y)), x.id, cash),
            );
            return {
                rowId: x.id,
                label: payAccountById.get(x.paymentAccountId ?? -1)?.label ?? "UPI",
                parts: plan,
                active: activeOf(x, plan),
                oneGo: !!x.oneGo,
                inPartsAmount: amountAs(false),
                oneScanAmount: amountAs(true),
            };
        }
        return null;
    })();
    const patchRow = (id: string, next: (x: TenderSplit) => TenderSplit) =>
        setSplits((prev) => prev.map((x) => (x.id === id ? next(x) : x)));
    // A part's checkbox — only that part. The plan is stored as it stands, so
    // no other part's amount moves. Ticking the part on display passes the
    // display to the next part still to come in.
    const setUpiPartReceived = (index: number, on: boolean) => {
        if (!upiPanel || !upiPanel.parts[index]) return;
        const plan = upiPanel.parts.map((p, i) => (i === index ? { ...p, received: on } : p));
        let active = upiPanel.active;
        if (on && active === index) {
            const after = plan.findIndex((p, i) => i > index && !p.received);
            active = after >= 0 ? after : plan.findIndex((p) => !p.received);
        }
        patchRow(upiPanel.rowId, (x) => ({ ...x, plan, activePart: active >= 0 ? active : undefined }));
    };
    // Pick a part to receive now — its QR goes on the customer display.
    const selectUpiPart = (index: number) => {
        if (!upiPanel || !upiPanel.parts[index] || upiPanel.parts[index].received) return;
        patchRow(upiPanel.rowId, (x) => ({ ...x, plan: upiPanel.parts, activePart: index }));
    };
    // Tick the part on display.
    const tickUpiPart = () => { if (upiPanel && upiPanel.active >= 0) setUpiPartReceived(upiPanel.active, true); };
    // Parts ⇄ one scan. The row moves to what that choice comes to, so the bill
    // stays covered (one scan carries the bank charge in the price); parts already
    // received stay, the rest is planned afresh.
    const setUpiOneGo = (oneGo: boolean) => {
        if (!upiPanel) return;
        const amount = oneGo ? upiPanel.oneScanAmount : upiPanel.inPartsAmount;
        patchRow(upiPanel.rowId, (x) => ({ ...x, oneGo, amount, plan: keepReceived(x), activePart: undefined }));
    };
    // The part being received on a row — what its Share QR asks for.
    const duePartOf = (s: TenderSplit): number | null => {
        if (!isTracked(s)) return null;
        const plan = planOf(s);
        const i = activeOf(s, plan);
        return i >= 0 ? plan[i].amount : null;
    };
    // Total entered against UPI-channel accounts — drives the customer-display QR.
    // With parts, only the part due now; a row whose parts are all in shows none.
    const upiEntered = upiPart ? upiPart.amount : splits.reduce(
        (s, x) => s + (isUpiRow(x) && !isTracked(x) ? x.amount : 0),
        0,
    );
    // VPA of the UPI account the cashier is collecting into — the per-counter payee
    // for the DQ11 pay QR. First UPI split with a configured VPA wins (a counter
    // usually has one). Same per-counter source as the Share QR; no relay fallback.
    const upiVpa = upiPart?.vpa ?? splits
        .map((x) => payAccountById.get(x.paymentAccountId ?? -1))
        .find((a) => a?.channel === "UPI" && a.vpa)?.vpa ?? null;
    const collected = cashNet + splitsSum;
    const onCredit = Math.max(0, payableTotal - collected);
    const overpaid = Math.max(0, collected - payableTotal);
    const balanceDue = snapshot?.balanceDue ?? 0;
    // Signed ledger balance (negative = the customer is in credit). `balanceDue`
    // is the clamped "how much is due" figure; the credit-limit guard and the
    // checkout wording both need the real sign, exactly as the server's
    // checkCreditLimit does.
    const ledgerBalance = snapshot?.account?.balance ?? balanceDue;
    const arrearPaid = Math.min(overpaid, balanceDue);
    const advanceTaken = Math.max(0, overpaid - balanceDue);

    // The Explorer hover shows the price this customer would actually start
    // at (their group may bill it at MRP / print price). Memoised: the display
    // effect keys on this object, so a fresh one per render would reset its
    // debounce on every keystroke.
    const hoverPreviewAtGroupPrice = useMemo(() => {
        if (!hoverPreviewProduct) return null;
        const startPaise = groupStartPricePaise(ruleForGroup(snapshot?.groupPricing, hoverPreviewProduct.groupId), {
            salePaise: hoverPreviewProduct.effectiveSalePricePaise,
            tagPaise: hoverPreviewProduct.barcodePricePaise,
            mrpPaise: hoverPreviewProduct.mrpPaise,
        });
        return startPaise === hoverPreviewProduct.effectiveSalePricePaise
            ? hoverPreviewProduct
            : { ...hoverPreviewProduct, effectiveSalePricePaise: startPaise };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the rules' content, not the snapshot object
    }, [hoverPreviewProduct, groupPricingSig]);

    // Customer-facing display coordinator (shared hook — the live QR/cart/customer
    // frames while a bill is built). The post-sale thank-you finale + printing stay
    // in each screen's submit routine; only this live coordinator is shared.
    usePosCustomerDisplay({
        displayHold, checkoutOpen, upiEntered, upiVpa, upiPayeeName: DEFAULT_PAYEE_NAME,
        upiCaption: upiPart ? `Part ${upiPart.index} of ${upiPart.count} · Pay ₹${upiPart.amount.toFixed(2)} via UPI` : null,
        cashNet, splitsSum, payableTotal, collected,
        cart, lineRows: billLineRows, snapshot, subtotal: billSubtotal, discountAmount, total, totalDiscount,
        effDiscountAmount: billTierDiscount, effRedemptionRupees, couponRupees, posExtraCharges, posTierLabel,
        hoverPreview: hoverPreviewAtGroupPrice,
    });

    // Credit-limit guard — true when the on-credit portion of this sale would
    // push the customer's outstanding balance past their credit limit. This is
    // the ONLY thing blocking a part-paid or fully-unpaid counter bill, so it is
    // deny-by-default: anything we cannot vouch for (no customer loaded, no
    // limit) gets no credit. The server's checkCreditLimit decides for real —
    // it also refuses an anonymous walk-in ledger, limit or no limit.
    const creditLimitBreached: boolean = (() => {
        if (onCredit <= 0) return false;   // fully paid, no AR impact
        const limit = snapshot?.creditLimit ?? null;
        if (limit === null) return true;   // no customer / no limit → no credit
        if (limit === 0) return true;      // zero-credit account
        return (ledgerBalance + onCredit) > limit;
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
        fetchSnapshot, onPartyPicked, clearCustomer, changingParty,
        // product search + cart
        productQuery, setProductQuery, productHighlight, setProductHighlight,
        filteredProducts, productGuessIds, setHighlightTouched, allProducts, hoverPreviewProduct, setHoverPreviewProduct,
        cart, setCart, renderCart, addToCart, setQty, setPrice, setLineDescription, onProductKeyDown,
        cartSelectedId, setCartSelectedId,
        saleNoteMissing,
        // POS services (added from the "+ Add service charge" button, not the search)
        allServices, addServiceToCart,
        // checkout / tenders
        checkoutOpen, setCheckoutOpen, shareOpen, setShareOpen, shareVpa, setShareVpa,
        clearCartDialogOpen, setClearCartDialogOpen, clearBill,
        pay, setPay, splits, setSplits, submitting, setSubmitting, openCheckout,
        // adjustments / offers
        adjustmentsOpen, setAdjustmentsOpen, shippingAmt, shippingAmtStr, setShippingAmtStr,
        redeemPointsStr, setRedeemPointsStr, redeemOn, setRedeemOn,
        couponCodeStr, setCouponCodeStr, appliedCoupon, setAppliedCoupon, autoCoupon,
        couponBusy, applyCoupon, applyOffer, applyOfferById, offers, crossSell,
        // Independent free-grant coupon (FREE_ITEM / BOGO) — applies on top.
        appliedFree, setAppliedFree, applyFreeCoupon, clearFreeCoupon, freeBusy,
        autoFree, setAutoFree,
        giftCard, setGiftCard, giftCardCodeStr, setGiftCardCodeStr, gcBusy, applyGiftCard,
        roundOff, autoRoundOff, roundOffStr, setRoundOffStr, roundOffManuallyEdited, setRoundOffManuallyEdited,
        charges, setCharges, resetDraft, resetAfterSubmit, ticketId, convertFrom, setConvertFrom,
        // shift
        activeShift, setActiveShift, takeover, setTakeover, openTakeover, shiftLoaded,
        shiftOpenDialogOpen, setShiftOpenDialogOpen, returnDialogOpen, setReturnDialogOpen,
        expenditureDialogOpen, setExpenditureDialogOpen, receiptDialogOpen, setReceiptDialogOpen,
        shiftDropOpen, setShiftDropOpen, shiftCloseOpen, setShiftCloseOpen,
        refreshActiveShift, shiftOpenedAt,
        payAccounts, payAccountById,
        // payment-method MDR + UPI parts (paymentMdr.ts)
        partsOf, fillAmountFor, methodTotals, upiPartsPending,
        upiPanel, tickUpiPart, setUpiPartReceived, selectUpiPart, setUpiOneGo, duePartOf,
        mdrRecovery: opts.paymentMdr ? mdrRecoveryNow : undefined,
        // bill math
        // lineRows / subtotal / tax / effDiscountAmount are the BILL's figures —
        // after any customer-group rebate — so the summary, the customer display
        // and the printed slip all reconcile to `total`.
        lineRows: billLineRows, subtotal: billSubtotal, tax: billTax,
        discountPct, synthDiscountPct, discountAmount, totalDiscount,
        tier, currentSaleValue,
        rates, canRedeem, loyaltyBalance, redeemBlocked, maxRedeemablePts,
        effRedeemPts, effRedemptionRupees, effDiscountAmount: billTierDiscount, couponRupees,
        couponDroppedTier, couponBlockedLoyalty, onTopRupees,
        // Each line's level discount (₹, before GST) — what an edit saves on its lines.
        lineTierDiscounts: lineTierAfterCoupon,
        total, giftCardApplied, payableTotal, posExtraCharges, posTierLabel,
        // tender math
        cashNet, splitsSum, upiEntered, collected, onCredit, overpaid, balanceDue, ledgerBalance,
        arrearPaid, advanceTaken, creditLimitBreached,
        // customer display
        displayHold, setDisplayHold,
        // the posted sale being re-saved, if any
        editBill: eb,
    };
}

export type PosBilling = ReturnType<typeof usePosBilling>;
