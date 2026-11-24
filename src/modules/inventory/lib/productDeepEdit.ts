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

/** Keep only the fields whose value differs from the loaded product. */
export function changedFields<T extends Record<string, unknown>>(payload: T, loaded: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(payload).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(loaded[k])),
    ) as Partial<T>;
}

/** Keep only the fields the deep-edit permission may change. */
export function onlyDeepEditFields<T extends Record<string, unknown>>(payload: T): Partial<T> {
    return Object.fromEntries(Object.entries(payload).filter(([k]) => allowed.has(k))) as Partial<T>;
}
