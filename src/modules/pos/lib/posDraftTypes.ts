// Shared types for the POS draft (the customer + goods + bill-adjustment slice
// carried across the Sale / Order / Estimate screens). Extracted verbatim from
// PosScreen / PosQuoteScreen — both screens and the posDraftStore import from here
// so the one draft shape has a single definition.

import { type TierPeriodInput, type TierTitle } from "@/shared/lib/pricing";
import { type QualityLogEntry } from "@/modules/customer/lib/customerQuality";
import { type GroupPricing } from "@/modules/pricing-strategy/lib/groupPricing";

export type Snapshot = {
    party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null };
    /// The Walk-in Cash Customer cash sale — `party` is a stand-in (id 0).
    isWalkIn?: boolean;
    account: { id: number; balance: number; openingBalance: number | null } | null;
    turnover: { lifetime: number; last12Months: number; invoiceCount: number };
    // Spend-tier periods with their bracket spend already attached. The POS re-resolves
    // these against the live cart (a CURRENT_SALE period scores 0 here), so treat the
    // `tier*` fields below as the history-only view — usePosBilling is the live truth.
    tierPeriods: TierPeriodInput[];
    tierCapPct: number | null;
    tierTitles: TierTitle[];
    rawTierPct: number;
    cappedByGuard: boolean;
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
    creditLimit: number;           // deny-by-default: 0 = no credit, >0 = cap (the account's empty limit reads as 0)
    balanceDue: number;
    balanceOverdue: number;
    availableCredit: number;       // = max(0, creditLimit − signed ledger balance), so an advance adds headroom
    rating: number | null;
    // Customer Quality staff timeline (ratings + behaviour comments). The POS
    // panel shows recent entries and appends new ones via /api/customer-quality.
    qualityLog: QualityLogEntry[];
    favouriteCategory: string | null;
    personalizedOffers: Array<{ id: string; label: string; tag: string }>;
    lastVisitAt: string | null;
    recentTickets: Array<{ id: number; createdAt: string; statusLabel: string; statusColor: string }>;
    warrantiesEnding: Array<{ productName: string; endsAt: string }>;
    /// Customer-group price rules (Pricing Strategy → Group pricing), already
    /// walked down the product-group tree. null/absent = normal pricing. Picks
    /// each line's starting price at add-to-cart and the silent group rebate.
    groupPricing?: GroupPricing | null;
};

export type ProductOption = {
    id: number; sku: string; name: string;
    /// Every scannable code on the product (barcode + EAN + UPC) — search only.
    codes?: { kind: string; value: string }[];
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
    /// GST-EXCLUSIVE resolved cost (paise) via the product's effective cost method —
    /// the SAME basis pricing marks up from. Snapshotted onto the cart line as the
    /// spend-tier discount base. null = no cost basis → no tier discount on the line.
    costPaise?: number | null;
    /// Loyalty redeem-cap override (% of this item's value redeemable with points).
    /// null = inherit the global cap. Snapshotted onto the cart line at add time.
    redeemCapPct?: number | null;
    /// Discount-protected (ProductProtection blacklist) — excluded from the
    /// spend-tier discount, loyalty redemption, and coupons on the POS screen.
    protected?: boolean;
    unit?: { code: string };
    warrantyTerm?: { name: string; durationDays: number | null } | null;
    /// Merchandising hierarchy (brand / storefront group-tree / cross-cutting
    /// category) — already selected by the lookup API, just not previously
    /// typed here. Used by the Product Explorer's browse facets.
    groupId?: number | null;
    categoryId?: number | null;
    brand?: { name: string } | null;
    /// Available-to-sell = on-hand minus reserved. null when stock is untracked.
    availableToSell?: number | null;
    /// Shelf photo, if the product has one — shown as a small thumbnail on the
    /// Product Explorer's tiles.
    imageUrl?: string | null;
    /// Free-form naming/attribute values keyed by InvAttributeMaster.key
    /// ("colour", "storage", "os", …). Explorer reads "colour"/"color" for a
    /// quick variant badge; nothing else here is admin-defined and unstable.
    attrsJson?: Record<string, string> | null;
    /// When true, the cashier must fill the line note before checkout. Snapshotted
    /// onto the cart line at add-to-cart (mirrors warrantyLabel).
    requireSaleNote?: boolean;
    /// Cross-sell provenance from /api/pos/coupon-offers — the drawer renders the
    /// four sources differently:
    ///   "history" — the customer bought it before (carries the last-purchase
    ///               snapshot below), "hot" — store best-seller fill,
    ///   "offer"   — the item an active independent FREE_ITEM / BOGO offer gives
    ///               away (see crossSellOffer), "shelf" — same-category fallback.
    crossSellSource?: "history" | "hot" | "offer" | "shelf";
    /// ISO date of the customer's last purchase of this product (history rows only).
    lastBoughtAt?: string | null;
    /// Unit price (paise) paid at that last purchase (history rows only).
    lastUnitPricePaise?: number | null;
    /// When crossSellSource === "offer" — the active free-grant offer this product
    /// is the free item of, so the drawer can badge the row "FREE with <offer>".
    crossSellOffer?: {
        couponId: number;
        /// Benefit line of the offer ("Buy 1 get 1 FREE — Free Carry Bag").
        name: string;
        /// Units granted when the offer fires.
        freeQty: number;
        /// The offer already fires on this cart (auto-granted at checkout).
        ready: boolean;
    } | null;
};

/// One row of /api/pos/services — the active POS service catalogue. Services are
/// NOT in the product search (they have no barcode); they are added from the
/// "+ Add service charge" button in the cart area and become kind="service"
/// cart lines (GL-only on sale — income ledger + GST, never stock).
export type PosServiceOption = {
    id: number;
    name: string;
    /// GST % from the service's configured GstRate (0 = untaxed).
    taxRate: number;
    /// Optional default TAX-INCLUSIVE price (paise); null = cashier types it.
    defaultPricePaise: number | null;
};

export type CartLine = {
    /// Cart-line key. Products carry the real InvProduct id; POS-service lines
    /// carry −posServiceId (negative, so the two id spaces never collide and
    /// the productId-keyed qty/price/description setters work unchanged).
    productId: number; sku: string; name: string;
    /// "service" marks a POS-service line (GL-only — Cr income + Cr GST, no
    /// stock). Absent/undefined = a normal product line.
    kind?: "service";
    qty: number; unitPrice: number; description: string;
    /// Snapshotted at add-to-cart time so changing a product's GST later
    /// doesn't retroactively shift prices in an active sale.
    taxRate: number;
    /// GST-EXCLUSIVE cost (paise) snapshotted at add-to-cart time — the spend-tier
    /// discount base (discount = tier% × costExcl, applied pre-tax per line). The
    /// server re-resolves this from the ledger and never trusts the client value.
    /// null = no cost basis → the line gets no tier discount.
    costPaise?: number | null;
    mrpPaise?: number | null;
    /// Barcode / printed tag price (paise) snapshotted at add-to-cart time — feeds
    /// the customer-facing price ladder (barcode line + "price benefit").
    barcodePaise?: number | null;
    warrantyLabel?: string | null;
    /// When true this line's note is mandatory — the Checkout button stays
    /// disabled until `description` is filled. Snapshotted from the product.
    requireSaleNote?: boolean;
    /// Loyalty redeem-cap override (% redeemable with points; null = global cap).
    /// Snapshotted so the redeem ceiling matches the server's at checkout.
    redeemCapPct?: number | null;
    /// Discount-protected (ProductProtection blacklist) — the line gets no tier
    /// discount and sits outside the loyalty redeem ceiling on the POS screen.
    protected?: boolean;
    /// Group pricing inputs, snapshotted at add-to-cart: the product's normal
    /// sale price (paise, tax-inclusive) and its product group. With them a
    /// customer change can re-price the line by the new customer's group rule.
    salePaise?: number | null;
    groupId?: number | null;
    /// True while the line still carries the price the POS picked itself. A
    /// cashier's typed price clears it, and a hydrated edit / converted line
    /// never has it — only auto-priced lines follow a customer change.
    autoPrice?: boolean;
    /// FREE-GRANT line: the item an independent FREE_ITEM / BOGO coupon granted.
    /// Display-only on the POS (zero price + FREE badge so the cashier hands it
    /// over) — it is NOT sent in the sale payload; the server re-derives it from
    /// the applied free coupon code.
    free?: boolean;
};

/// A validated coupon as the coupon-validate route returns it — the server owns
/// the ₹ value; the client mirrors droppedTier / blockedLoyalty in the bill.
export type CouponHit = {
    couponId: number;
    code: string | null;
    name: string;
    rupees: number;
    droppedTier: boolean;
    blockedLoyalty: boolean;
    /// Rule 3 — a non-independent fully-free FREE_ITEM / BOGO coupon WON the
    /// money slot: its item is granted as zero-price FREE lines (display rows
    /// with the FREE badge) while the checkout payload still rides the money
    /// slot (exclusivity applies server-side). rupees is 0 in this case.
    freeLines?: { productId: number; freeQty: number; productName: string }[];
};

/// A validated hit from the ON-TOP slot — an INDEPENDENT FREE_ITEM / BOGO
/// coupon applying ON TOP of the money coupon (never drops tier / blocks
/// loyalty / hits the guard). Two flavours:
///   • Rule 1 — fully free: grants `freeLines` at zero price (the POS shows
///     the FREE badge so the counter operator doesn't forget the item).
///   • Rule 2 — partial (<100%): a ₹ discount (`onTop` true) on its item once
///     in the cart; `freeLines` is empty and `rupees` is the on-top ₹.
export type OnTopHit = {
    couponId: number;
    code: string | null;
    name: string;
    freeLines: { productId: number; freeQty: number; productName: string }[];
    /// Rule 2 — partial: true means this is an on-top ₹ discount (not a grant).
    onTop?: boolean;
    /// Rule 2 — the on-top ₹ off the bill.
    rupees?: number;
};

/// One offer in the POS "Offers" upsell panel — computed server-side against the
/// live cart (see /api/pos/coupon-offers). The client only renders.
export type PosOffer = {
    couponId: number;
    code: string | null;
    name: string;
    type: "PERCENT" | "FLAT" | "FREE_ITEM" | "BOGO" | "SET_PRICE";
    applyMode: "CODE" | "AUTO";
    status: "ready" | "progress" | "unavailable";
    /// Human-readable benefit line: "1 × Fanta FREE", "−10% off (max ₹200)" …
    benefit: string;
    /// Human-readable requirement line: "Min bill ₹1,000 · Eligible items only" …
    requirement: string;
    /// The gate the cashier can push on (buy units for BOGO, bill value otherwise).
    progress: { current: number; target: number; unit: "₹" | "units"; pct: number } | null;
    /// The upsell nudge: "Add ₹200 more to unlock" / "Add 1 more Coke to unlock".
    gapText: string | null;
    /// Supplementary guidance: "Scan Fanta to collect", "Eligible items only" …
    note: string | null;
    /// ₹ this offer is worth on the current cart (only when it already applies).
    saveEstimate: number | null;
    unavailableReason: string | null;
    stackable: boolean;
    stackScope: "BILL" | "LINE";
    expiresAt: string | null;
    usageLeft: number | null;
    /// FREE-GRANT coupon (independent + fully free) — applies on top; the
    /// apply action adds its free lines at zero price instead of a ₹ coupon.
    /// A partial (not 100%) free-item offer is false here — it's a money
    /// coupon that waits for its item to be added to the cart.
    freeGrant: boolean;
    /// BOGO / FREE_ITEM mechanic (forward-looking: the free-line auto-add uses these).
    freeProductId: number | null;
    freeProductName: string | null;
    buyProductId: number | null;
    buyProductName: string | null;
    buyQty: number | null;
    getQty: number | null;
    freeQty: number | null;
    freeDiscountPct: number | null;
};

export type ChargeRow = { id: string; accountId: number | null; description: string; amount: string };
