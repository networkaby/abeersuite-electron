// "Deep edit" by E-Commerce staff (ecommerce:product:deep-edit) without
// Inventory products:edit. One list, read by the dialog (what it sends) and by
// PATCH /api/inventory/products/[id] (what it accepts) so the two never drift.
//
// An allow-list on purpose: a field added to the product later stays closed to
// this permission until someone decides it belongs here. Left out today: SKU,
// sale price, opening stock / rate / branch and the GST fields.

export const DEEP_EDIT_FIELDS = [
    "name",
    "namePart",
    "shopSubheading",
    "slug",
    "unitId",
    "categoryId",
    "collectionIds",
    "groupId",
    "brandId",
    "warrantyTermId",
    "modelNo",
    "codes",
    "notes",
    "requireSaleNote",
    "isActive",
    "mrpPaise",
    "attrsJson",
] as const;

const allowed: ReadonlySet<string> = new Set(DEEP_EDIT_FIELDS);

/** True when every key of a PATCH body is one the deep-edit permission may change. */
export function isDeepEditBody(keys: readonly string[]): boolean {
    return keys.length > 0 && keys.every((k) => allowed.has(k));
}

/** Keep only allowed fields whose value differs from the loaded product. */
export function deepEditPayload<T extends Record<string, unknown>>(payload: T, loaded: T | null): Partial<T> {
    const out: Partial<T> = {};
    for (const k of DEEP_EDIT_FIELDS) {
        if (!(k in payload)) continue;
        if (loaded && JSON.stringify(payload[k]) === JSON.stringify(loaded[k])) continue;
        (out as Record<string, unknown>)[k] = payload[k];
    }
    return out;
}
