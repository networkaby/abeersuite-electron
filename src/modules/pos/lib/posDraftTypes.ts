// Shared types for the POS draft (the customer + goods + bill-adjustment slice
// carried across the Sale / Order / Estimate screens). Extracted verbatim from
// PosScreen / PosQuoteScreen — both screens and the posDraftStore import from here
// so the one draft shape has a single definition.

import { type TierPeriodInput, type TierTitle } from "@/shared/lib/pricing";
import { type QualityLogEntry } from "@/modules/customer/lib/customerQuality";

export type Snapshot = {
    party: { kind: "person" | "company"; id: number; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null };
    account: { id: number; balance: number; openingBalance: number | null } | null;
    turnover: { lifetime: number; last12Months: number; invoiceCount: number };
    // Spend-tier periods with their bracket spend already attached. The POS re-resolves
    // these against the live cart (a CURRENT_SALE period scores 0 here), so treat the
    // `tier*` fields below as the history-only view — usePosBilling is the live truth.
    tierPeriods: TierPeriodInput[];
    tierCapPct: number | null;
    tierTitles: TierTitle[];
    badgePeriodId: number | null;
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
    creditLimit: number | null;    // deny-by-default: 0 = no credit, >0 = cap (server maps legacy NULL→0)
    balanceDue: number;
    balanceOverdue: number;
    availableCredit: number | null; // = max(0, creditLimit − balanceDue)
    rating: number | null;
    // Customer Quality staff timeline (ratings + behaviour comments). The POS
    // panel shows recent entries and appends new ones via /api/customer-quality.
    qualityLog: QualityLogEntry[];
    favouriteCategory: string | null;
    personalizedOffers: Array<{ id: string; label: string; tag: string }>;
    lastVisitAt: string | null;
    recentTickets: Array<{ id: number; createdAt: string; statusLabel: string; statusColor: string }>;
    warrantiesEnding: Array<{ productName: string; endsAt: string }>;
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
    /// When true, the cashier must fill the line note before checkout. Snapshotted
    /// onto the cart line at add-to-cart (mirrors warrantyLabel).
    requireSaleNote?: boolean;
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
};

export type ChargeRow = { id: string; accountId: number | null; description: string; amount: string };

export const newChargeRow = (): ChargeRow => ({
    id: Math.random().toString(36).slice(2, 10),
    accountId: null,
    description: "",
    amount: "",
});
