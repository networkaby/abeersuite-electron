// 6-digit random SKU.
//
// Uniqueness is enforced server-side (`InvProduct.sku @unique`); the API
// returns 409 on conflict. With 1,000,000 possible values, collisions only
// matter at scale — the dialog can offer a "Regenerate" affordance when one
// happens. Keep this single helper as the source of truth so any caller that
// needs a starting SKU produces the same shape.

export function generateSku(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
}
