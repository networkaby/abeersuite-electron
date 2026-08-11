// Shared helpers for InvProductCode (scannable barcode / EAN / UPC child rows).
// Replaces the former repeating barcode1-3 / ean1-3 / upc1-3 columns on
// InvProduct. The "primary" code (first BARCODE-kind row) is what label/display
// surfaces show where a single barcode is expected.

export const PRODUCT_CODE_KINDS = ["BARCODE", "EAN", "UPC"] as const;
export type ProductCodeKind = (typeof PRODUCT_CODE_KINDS)[number];

/** One scannable code on a product. */
export type ProductCode = { kind: ProductCodeKind; value: string };

/**
 * The primary scannable barcode for display/label use: the first BARCODE-kind
 * code, falling back to the first code of any kind, else null. Accepts the loose
 * `{ kind, value }[]` shape Prisma selects return.
 */
export function primaryBarcode(
    codes: readonly { kind: string; value: string }[] | null | undefined,
): string | null {
    if (!codes || codes.length === 0) return null;
    return codes.find((c) => c.kind === "BARCODE")?.value ?? codes[0]?.value ?? null;
}

/**
 * Set / replace / clear the primary barcode within a code set without disturbing
 * the other codes (EANs, UPCs, secondary barcodes). Used by single-field editors
 * (products grid inline edit, CSV import) that only know one barcode value.
 *   value blank/null → removes the primary barcode (keeps the rest).
 */
export function withPrimaryBarcode(
    codes: readonly ProductCode[],
    value: string | null | undefined,
): ProductCode[] {
    const next = codes.map((c) => ({ ...c }));
    const idx = next.findIndex((c) => c.kind === "BARCODE");
    const v = (value ?? "").trim();
    if (v === "") {
        if (idx >= 0) next.splice(idx, 1);
        return next;
    }
    if (idx >= 0) next[idx] = { kind: "BARCODE", value: v };
    else next.unshift({ kind: "BARCODE", value: v });
    return next;
}

/**
 * Normalise a submitted code set for persistence: trim values, drop blanks, and
 * de-duplicate by value (last one wins) so a single write can't violate the
 * global unique constraint with its own rows.
 */
export function normalizeProductCodes(codes: readonly ProductCode[] | null | undefined): ProductCode[] {
    if (!codes) return [];
    const byValue = new Map<string, ProductCode>();
    for (const c of codes) {
        const value = c.value?.trim();
        if (!value) continue;
        byValue.set(value, { kind: c.kind, value });
    }
    return [...byValue.values()];
}

/**
 * Prisma `where` fragment for "search a product by anything scannable":
 * name, SKU, or any code (barcode / EAN / UPC) — partial, case-insensitive.
 * Returns undefined for a blank query (caller should skip the filter, not
 * apply an always-false one). Shared so every product search surface (grid,
 * pricing items, ecommerce admin, POS, help-desk lookup, …) matches the same
 * fields instead of drifting field-by-field.
 */
export function productSearchWhere(q: string | null | undefined) {
    const query = q?.trim();
    if (!query) return undefined;
    return {
        OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { sku: { contains: query, mode: "insensitive" as const } },
            { codes: { some: { value: { contains: query, mode: "insensitive" as const } } } },
        ],
    };
}

/**
 * Client-side counterpart of {@link productSearchWhere} for lists already
 * fetched into the browser (POS product picker, help-desk universal search,
 * update-print-labels table, …). Same fields, same partial/case-insensitive
 * matching, so a query behaves identically whether filtered server- or
 * client-side.
 */
export function productMatchesQuery(
    p: { name: string; sku?: string | null; codes?: readonly { value: string }[] | null },
    q: string,
): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    if (p.name.toLowerCase().includes(needle)) return true;
    if (p.sku && p.sku.toLowerCase().includes(needle)) return true;
    return (p.codes ?? []).some((c) => c.value.toLowerCase().includes(needle));
}
