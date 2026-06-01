// Pure loyalty math — no DB access. Earn-rule resolution, earn-base, redemption
// clamping. Kept side-effect-free so it can be unit-tested and reused across
// channels (POS today; office SALE / shop later).

export type LoyaltyRates = {
    enabled: boolean;
    /// ₹ of net goods value that earns 1 point at the global rate.
    globalEarnRatePer: number;
    /// ₹ value of 1 point on redemption.
    redeemValue: number;
    /// Dynamic expiry: a lot is live while earnedAt > now − expiryDays.
    /// expiryEnabled=false → never expires (no date filter).
    expiryEnabled: boolean;
    expiryDays: number;
    /// Minimum invoice value (₹) to earn / to redeem (null = no floor).
    minEarnInvoiceValue: number | null;
    minRedeemInvoiceValue: number | null;
    minRedeemPoints: number | null;
    maxRedeemPctOfBill: number | null;
};

/// A loyalty earn-rule row, narrowed to the fields the resolver needs.
export type EarnRule = {
    scope: "CATEGORY" | "GROUP" | "PRODUCT";
    categoryId: number | null;
    groupId: number | null;
    productId: number | null;
    multiplier: number;
    enabled: boolean;
};

/// One cart line, with the product's taxonomy + its pre-tax goods value.
export type EarnLine = {
    productId: number;
    groupId: number | null;
    categoryId: number | null;
    /// Pre-tax goods value for the line (quantity × unit price).
    goods: number;
};

export type RulesIndex = {
    byProduct: Map<number, number>;
    byGroup: Map<number, number>;
    byCategory: Map<number, number>;
};

/// Parent chains for the group + category trees, so the resolver can walk
/// ancestors (product → group → parent group → … → category → … → global).
export type TaxonomyMaps = {
    groupParent: Map<number, number | null>;
    categoryParent: Map<number, number | null>;
};

/// Build a LoyaltyConfig-shaped rates object from raw Decimal/number inputs.
export function ratesFromConfig(cfg: {
    enabled: boolean;
    globalEarnRatePer: unknown;
    redeemValue: unknown;
    expiryEnabled: boolean;
    expiryDays: number;
    minEarnInvoiceValue: unknown | null;
    minRedeemInvoiceValue: unknown | null;
    minRedeemPoints: number | null;
    maxRedeemPctOfBill: unknown | null;
}): LoyaltyRates {
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    return {
        enabled: cfg.enabled,
        globalEarnRatePer: Number(cfg.globalEarnRatePer),
        redeemValue: Number(cfg.redeemValue),
        expiryEnabled: cfg.expiryEnabled,
        expiryDays: cfg.expiryDays,
        minEarnInvoiceValue: num(cfg.minEarnInvoiceValue),
        minRedeemInvoiceValue: num(cfg.minRedeemInvoiceValue),
        minRedeemPoints: cfg.minRedeemPoints,
        maxRedeemPctOfBill: num(cfg.maxRedeemPctOfBill),
    };
}

/// The earliest earnedAt still inside the validity window — or null when expiry
/// is disabled (no date filter; all lots are live). Days-based.
export function expiryCutoff(now: Date, rates: { expiryEnabled: boolean; expiryDays: number }): Date | null {
    if (!rates.expiryEnabled || rates.expiryDays <= 0) return null;
    const d = new Date(now);
    d.setDate(d.getDate() - rates.expiryDays);
    return d;
}

export function buildRulesIndex(rules: EarnRule[]): RulesIndex {
    const idx: RulesIndex = { byProduct: new Map(), byGroup: new Map(), byCategory: new Map() };
    for (const r of rules) {
        if (!r.enabled) continue;
        const m = Number(r.multiplier);
        if (r.scope === "PRODUCT" && r.productId != null) idx.byProduct.set(r.productId, m);
        else if (r.scope === "GROUP" && r.groupId != null) idx.byGroup.set(r.groupId, m);
        else if (r.scope === "CATEGORY" && r.categoryId != null) idx.byCategory.set(r.categoryId, m);
    }
    return idx;
}

/// Resolve a line's earn multiplier with precedence
/// product → group (walk parent chain) → category (walk parent chain) → 1.0.
export function resolveEarnMultiplier(
    line: { productId: number; groupId: number | null; categoryId: number | null },
    idx: RulesIndex,
    maps: TaxonomyMaps,
): number {
    const pr = idx.byProduct.get(line.productId);
    if (pr !== undefined) return pr;

    let g = line.groupId;
    const seenG = new Set<number>();
    while (g != null && !seenG.has(g)) {
        seenG.add(g);
        const m = idx.byGroup.get(g);
        if (m !== undefined) return m;
        g = maps.groupParent.get(g) ?? null;
    }

    let c = line.categoryId;
    const seenC = new Set<number>();
    while (c != null && !seenC.has(c)) {
        seenC.add(c);
        const m = idx.byCategory.get(c);
        if (m !== undefined) return m;
        c = maps.categoryParent.get(c) ?? null;
    }

    return 1;
}

/// Effective earn base for a cart. The voucher-level discount (tier + redemption
/// ₹) is allocated across lines proportional to each line's goods value, then
/// each line's net is weighted by its earn multiplier.
export function earnableBaseForCart(
    lines: EarnLine[],
    combinedDiscount: number,
    idx: RulesIndex,
    maps: TaxonomyMaps,
): number {
    const totalGoods = lines.reduce((s, l) => s + l.goods, 0);
    if (totalGoods <= 0) return 0;
    const discount = Math.max(0, combinedDiscount);
    let base = 0;
    for (const l of lines) {
        const allocated = discount * (l.goods / totalGoods);
        const net = Math.max(0, l.goods - allocated);
        base += net * resolveEarnMultiplier(l, idx, maps);
    }
    return base;
}

/// Whole points earned on an effective base. Floors — never awards partial points.
export function pointsForBase(base: number, rates: LoyaltyRates): number {
    if (!rates.enabled || rates.globalEarnRatePer <= 0 || base <= 0) return 0;
    return Math.floor(base / rates.globalEarnRatePer);
}

/// ₹ value of redeeming N whole points.
export function redeemValueOf(points: number, rates: LoyaltyRates): number {
    if (points <= 0) return 0;
    return points * rates.redeemValue;
}

/// Server-authoritative redemption clamp. Returns the points actually allowed +
/// their ₹ value, or a `reason` when the request is rejected. `billGoodsValue`
/// is the reducible base (post-tier-discount, pre-GST goods) the redemption
/// cannot exceed.
export function clampRedemption(
    requestedPoints: number,
    balance: number,
    billGoodsValue: number,
    invoiceValue: number,
    rates: LoyaltyRates,
): { points: number; value: number; reason?: string } {
    if (!rates.enabled || requestedPoints <= 0) return { points: 0, value: 0 };
    if (rates.minRedeemInvoiceValue != null && invoiceValue < rates.minRedeemInvoiceValue) {
        return { points: 0, value: 0, reason: `Invoice must be at least ₹${rates.minRedeemInvoiceValue.toFixed(2)} to redeem points.` };
    }
    if (requestedPoints > balance) {
        return { points: 0, value: 0, reason: `Cannot redeem ${requestedPoints} points — only ${balance} available.` };
    }
    if (rates.minRedeemPoints != null && requestedPoints < rates.minRedeemPoints) {
        return { points: 0, value: 0, reason: `Minimum ${rates.minRedeemPoints} points required to redeem.` };
    }
    const value = redeemValueOf(requestedPoints, rates);
    const pctCap = rates.maxRedeemPctOfBill != null
        ? (billGoodsValue * rates.maxRedeemPctOfBill) / 100
        : Number.POSITIVE_INFINITY;
    const cap = Math.min(billGoodsValue, pctCap);
    if (value > cap + 0.005) {
        return { points: 0, value: 0, reason: `Redemption (₹${value.toFixed(2)}) exceeds the allowed cap of ₹${cap.toFixed(2)} for this bill.` };
    }
    return { points: requestedPoints, value };
}
