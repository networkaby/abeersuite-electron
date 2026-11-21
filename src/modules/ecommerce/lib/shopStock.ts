// Out-of-stock availability — pure / framework-free so it runs on the server
// (storefront APIs, order intake) and the client (product card / cart). The org
// sets a default policy; a per-product `allowBackorder` flag overrides it to
// always accept orders.

export type ShopOutOfStockPolicy = "HIDE" | "NOTIFY" | "BACKORDER";

export const DEFAULT_OUT_OF_STOCK_POLICY: ShopOutOfStockPolicy = "NOTIFY";

export const OUT_OF_STOCK_POLICY_LABELS: Record<ShopOutOfStockPolicy, string> = {
    HIDE: "Hide from shop",
    NOTIFY: "Show with a “Show interest” button — creates a deal (can’t order)",
    BACKORDER: "Allow orders anyway (backorder / procure later)",
};

export function normalizeStockPolicy(raw: unknown): ShopOutOfStockPolicy {
    return raw === "HIDE" || raw === "NOTIFY" || raw === "BACKORDER" ? raw : DEFAULT_OUT_OF_STOCK_POLICY;
}

export type StockStatus = "in_stock" | "out_of_stock" | "backorder";

export type ShopAvailability = {
    /** Should the product appear in the storefront at all? */
    visible: boolean;
    /** Can the customer add it to the cart / order it? */
    orderable: boolean;
    status: StockStatus;
};

/**
 * Resolve what the storefront should do with a product given its stock, its
 * per-product backorder override, and the org out-of-stock policy.
 *
 * - `stock === null/undefined` means untracked → always in stock.
 * - stock > 0 → in stock, orderable.
 * - stock <= 0 → backorder (visible+orderable) if the product allows backorder
 *   or the policy is BACKORDER; otherwise HIDE (not visible) or NOTIFY
 *   (visible, not orderable).
 */
export function resolveAvailability(
    stock: number | null | undefined,
    allowBackorder: boolean,
    policy: ShopOutOfStockPolicy,
    /** O2C reserved units held by confirmed orders — available-to-sell = stock − reserved. */
    reserved: number = 0,
): ShopAvailability {
    const tracked = stock !== null && stock !== undefined;
    const available = tracked ? stock - (reserved || 0) : null;
    if (!tracked || (available as number) > 0) {
        return { visible: true, orderable: true, status: "in_stock" };
    }
    // zero (or negative) tracked stock
    if (allowBackorder || policy === "BACKORDER") {
        return { visible: true, orderable: true, status: "backorder" };
    }
    if (policy === "HIDE") {
        return { visible: false, orderable: false, status: "out_of_stock" };
    }
    return { visible: true, orderable: false, status: "out_of_stock" }; // NOTIFY
}
