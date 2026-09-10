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

export type ProductSearchCandidate = {
    name: string;
    sku?: string | null;
    brand?: { name: string } | null;
    attrsJson?: unknown;
    codes?: readonly { value: string }[] | null;
};

function productSearchText(p: ProductSearchCandidate): string {
    const parts: string[] = [p.name, p.sku ?? "", p.brand?.name ?? ""];
    if (p.attrsJson && typeof p.attrsJson === "object") {
        for (const v of Object.values(p.attrsJson as Record<string, unknown>)) {
            if (typeof v === "string") parts.push(v);
        }
    }
    for (const c of p.codes ?? []) parts.push(c.value);
    return parts.join(" ").toLowerCase();
}

/** Split product text into individual words for fuzzy matching. */
function productWords(p: ProductSearchCandidate): string[] {
    return productSearchText(p).split(/\s+/).filter(Boolean);
}

/**
 * Fast Levenshtein distance check — true when the edit distance is ≤ `max`
 * (1 or 2). Row-at-a-time DP with an early bail-out once a whole row is over
 * budget, so it stays cheap for the short strings we compare (product tokens).
 */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
    const al = a.length, bl = b.length;
    if (Math.abs(al - bl) > max) return false;
    let prev = Array.from({ length: bl + 1 }, (_, j) => j);
    for (let i = 1; i <= al; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            row.push(v);
            if (v < best) best = v;
        }
        if (best > max) return false; // every path already over budget
        prev = row;
    }
    return prev[bl] <= max;
}

// Match tiers, worst → best. A token scores the highest tier it can reach.
const TIER_TYPO = 10;
const TIER_INSIDE = 100;
const TIER_PREFIX = 200;
const TIER_SUBSTRING = 300;
const TIER_WORD_START = 400;
const TIER_LADDER = [0, TIER_TYPO, TIER_INSIDE, TIER_PREFIX, TIER_SUBSTRING, TIER_WORD_START];
/** Added on top of the tier when the whole query appears as one contiguous run. */
const FULL_QUERY_BONUS = 100;

/**
 * Did this score come from the typo tier — i.e. no word actually matched, the
 * query was merely one or two edits away? Such a row is a suggestion, not a
 * hit, and the POS dropdown colours it like the fuzzy/guess rows even though
 * scoreProductSearch (not the fallbacks) produced it.
 */
export function isWeakScore(score: number): boolean {
    return score === TIER_TYPO || score === TIER_TYPO + FULL_QUERY_BONUS;
}

/** One step down the ladder — what a rescued (split) token is allowed to score,
 *  so a real match always outranks a reconstructed one. Never below the typo
 *  tier: a split that matched at all is still a signal, and dropping it to 0
 *  would throw the whole product away. */
function demoteTier(tier: number): number {
    const i = TIER_LADDER.indexOf(tier);
    return i <= 0 ? 0 : Math.max(TIER_LADDER[i - 1], TIER_TYPO);
}

/** How well one query token matches one product. `fuzzyMax` is the typo budget;
 *  2 is only ever allowed on tokens long enough that it can't match half the shop. */
function tokenTier(token: string, text: string, words: string[], fuzzyMax: number): number {
    const idx = text.indexOf(token);
    if (idx !== -1) return idx === 0 || text[idx - 1] === " " ? TIER_WORD_START : TIER_SUBSTRING;
    if (words.some((w) => w.startsWith(token))) return TIER_PREFIX;
    if (words.some((w) => w.includes(token))) return TIER_INSIDE;
    const budget = token.length >= 5 ? fuzzyMax : Math.min(fuzzyMax, 1);
    if (words.some((w) => editDistanceAtMost(token, w, budget))) return TIER_TYPO;
    return 0;
}

/** Shortest piece a split is allowed to produce — below this nearly every
 *  product matches and the rescue turns into noise. */
const MIN_SPLIT_PIECE = 2;

/**
 * Rescue for a token the cashier ran together: "pen32", "a4paper", "papera4",
 * "camcp". Tries every two-way split, scores both halves with the normal
 * ladder, and keeps the best — worst half wins within a split, demoted one
 * tier so it never outranks a genuine match. 0 when no split works.
 */
function splitTokenTier(token: string, text: string, words: string[], fuzzyMax: number): number {
    if (token.length < MIN_SPLIT_PIECE * 2) return 0;
    let best = 0;
    for (let i = MIN_SPLIT_PIECE; i <= token.length - MIN_SPLIT_PIECE; i++) {
        const left = tokenTier(token.slice(0, i), text, words, fuzzyMax);
        if (!left) continue;
        const right = tokenTier(token.slice(i), text, words, fuzzyMax);
        if (!right) continue;
        best = Math.max(best, Math.min(left, right));
    }
    return demoteTier(best);
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
    const q = query.trim().toLowerCase();
    if (!q) return 1;
    const text = productSearchText(p);
    if (!text) return 0;

    // Bonus when the full query appears as a contiguous substring
    const fullBonus = text.includes(q) ? FULL_QUERY_BONUS : 0;

    const words = productWords(p);
    let tier = 0; // worst tier across all tokens (lower = worse)

    for (const token of q.split(/\s+/).filter(Boolean)) {
        // Whole token first — unchanged ranking for everything that already
        // matched. Only a token that scores nothing gets the split rescue.
        const hit = tokenTier(token, text, words, 1) || splitTokenTier(token, text, words, 1);
        if (!hit) return 0; // token not found at all
        tier = Math.max(tier, hit);
    }
    return tier + fullBonus;
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
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const text = productSearchText(p);
    if (!text) return 0;

    const words = productWords(p);
    let total = 0;
    for (const token of q.split(/\s+/).filter(Boolean)) {
        const hit = tokenTier(token, text, words, 2) || splitTokenTier(token, text, words, 2);
        total += hit / 10; // same ladder, scaled down: 400 → 40 … 10 → 1
    }
    return total;
}

/**
 * Last resort so the dropdown is never blank: what share of the query's letter
 * pairs appear anywhere in the product text. Deliberately crude — it always
 * returns a number, so the caller can sort by it and take the top rows even
 * when nothing really matches.
 */
export function rawOverlapScore(p: ProductSearchCandidate, query: string): number {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return 0;
    const text = productSearchText(p);
    if (!text) return 0;
    if (q.length < 2) return text.includes(q) ? 1 : 0;
    let hits = 0;
    for (let i = 0; i < q.length - 1; i++) if (text.includes(q.slice(i, i + 2))) hits++;
    return hits / (q.length - 1);
}
