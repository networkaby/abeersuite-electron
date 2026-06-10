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
