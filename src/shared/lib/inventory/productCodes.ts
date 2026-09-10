// Shared helpers for InvProductCode (scannable barcode / EAN / UPC child rows).
// Replaces the former repeating barcode1-3 / ean1-3 / upc1-3 columns on
// InvProduct. The "primary" code (first BARCODE-kind row) is what label/display
// surfaces show where a single barcode is expected.

// The matcher itself is not about products — it lives in `search/textScore` and
// is shared with the party search. Re-exported here so every existing product
// caller keeps importing from the same place it always did.
import { scoreSearchText, looseScoreText, overlapScoreText } from "@/shared/lib/search/textScore";
export { scoreSearchText, looseScoreText, overlapScoreText, isWeakScore } from "@/shared/lib/search/textScore";

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

export type ProductSearchCandidate = {
    name: string;
    sku?: string | null;
    brand?: { name: string } | null;
    attrsJson?: unknown;
    codes?: readonly { value: string }[] | null;
};

/** The internal searchable text for a product — name, SKU, brand, string
 *  attributes and every scannable code, lowercased. The default field set for
 *  searchProducts; the public storefront passes its own, narrower one. */
export function productSearchText(p: ProductSearchCandidate): string {
    const parts: string[] = [p.name, p.sku ?? "", p.brand?.name ?? ""];
    if (p.attrsJson && typeof p.attrsJson === "object") {
        for (const v of Object.values(p.attrsJson as Record<string, unknown>)) {
            if (typeof v === "string") parts.push(v);
        }
    }
    for (const c of p.codes ?? []) parts.push(c.value);
    return parts.join(" ").toLowerCase();
}



/**
 * Tokenized product search — splits the query into whitespace tokens and
 * requires every token to appear somewhere in name/sku/brand/attrsJson/codes
 * (order doesn't matter), so "32 gb pendrive" matches "SanDisk Pendrive 32GB".
 * Returns 0 for no match; higher score = closer match, for ranking results.
 * Falls back to fuzzy matching (Levenshtein ≤ 1) when exact/prefix match fails,
 * so typos like "sadisk" still find "sandisk", and to a two-way split when the
 * cashier runs words together ("pen32", "a4paper") — a split can only ever
 * score a tier below a real match.
 * Used by POS product picker and the office dashboard's product quick-lookup
 * (UniversalCustomerPanel). See looseProductScore for the POS-only fallback
 * that runs when this returns nothing for every product.
 */
export function scoreProductSearch(p: ProductSearchCandidate, query: string): number {
    return scoreSearchText(productSearchText(p), query);
}

/**
 * Looser sibling of scoreProductSearch, for the POS dropdown only: no token is
 * mandatory and the tiers ADD UP, so a product matching 3 of 4 tokens outranks
 * one matching 1. The typo budget widens to 2 edits on tokens of 5+ characters
 * ("hddseaget" → "hdd" + "seagate"). Returns 0 when not one token lands.
 *
 * Only ever run when scoreProductSearch found nothing for the whole catalogue —
 * its results are guesses and the dropdown colours them as such.
 */
export function looseProductScore(p: ProductSearchCandidate, query: string): number {
    return looseScoreText(productSearchText(p), query);
}

/**
 * Last resort so the dropdown is never blank: what share of the query's letter
 * pairs appear anywhere in the product text. Deliberately crude — it always
 * returns a number, so the caller can sort by it and take the top rows even
 * when nothing really matches.
 */
export function rawOverlapScore(p: ProductSearchCandidate, query: string): number {
    return overlapScoreText(productSearchText(p), query);
}
