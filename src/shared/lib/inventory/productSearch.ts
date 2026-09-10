// ── searchProducts ────────────────────────────────────────────────────────────
// The one product search every picker in the app runs through: the POS scan
// box, the voucher item row, the scan input, the item picker dialog, the BOM
// picker and the public storefront. Before this, four components each had their
// own ranking for the same job and they disagreed with each other.
//
// The scoring itself lives in `productCodes.ts` (the tier ladder, the
// run-together split rescue, the fuzzy and letter-pair fallbacks). This file is
// only the policy on top: how many rows, which fields, and whether a failed
// search is allowed to fall back to guesses.

import {
    scoreSearchText,
    looseScoreText,
    overlapScoreText,
    isWeakScore,
    productSearchText,
    type ProductSearchCandidate,
} from "./productCodes";

export type ProductSearchOptions<T> = {
    /** How many rows to return. Default 12. */
    rows?: number;
    /**
     * Let a search that found nothing fall back to looser matching and then to
     * letter-pair closeness, so the list keeps its height instead of going
     * blank. OFF by default — only the till wants it, because a cashier with a
     * customer waiting is better served by a wrong-looking suggestion than by
     * an empty box. A voucher line is a deliberate choice, so an empty list
     * there is honest.
     */
    fallback?: boolean;
    /**
     * The searchable text for one item. Defaults to the internal set — name,
     * SKU, brand, string attributes and every scannable code. The public
     * storefront passes its own, which is why nothing internal can leak there.
     */
    text?: (item: T) => string;
    /** Identity for the guess set and for de-duplication. Defaults to `id`. */
    id?: (item: T) => number | string;
};

export type ProductSearchResult<T> = {
    rows: T[];
    /**
     * Rows nothing really matched — the fallback rows, plus a typo-tier hit
     * from the real search ("abc" reaching "TV Remote ACC"), which is a
     * suggestion wearing an exact-match coat. Callers that show confidence
     * (the POS dropdown) colour these; the rest can ignore the set.
     */
    guessIds: Set<number | string>;
};

/**
 * Rank `items` against `query`.
 *
 * Up to three passes, each running only when the one before found nothing
 * genuine, so a search that worked is never padded — "seagate" finding its two
 * hard disks shows two rows, not those two buried under ten "Sata cable"
 * guesses. Filler must still score, so nothing arbitrary is ever shown.
 */
export function searchProducts<T>(
    items: readonly T[],
    query: string,
    opts: ProductSearchOptions<T> = {},
): ProductSearchResult<T> {
    const limit = opts.rows ?? 12;
    const textOf = opts.text ?? ((item: T) => productSearchText(item as ProductSearchCandidate));
    const idOf = opts.id ?? ((item: T) => (item as { id: number | string }).id);

    const guessIds = new Set<number | string>();
    const q = query.trim();
    if (!q) return { rows: [], guessIds };

    // The text is built once per item and reused by every pass — assembling it
    // per pass was the whole cost of the search on a few thousand products.
    const texts = new Map<T, string>();
    for (const item of items) texts.set(item, textOf(item));

    const rows: T[] = [];
    const taken = new Set<number | string>();

    /** Rank the not-yet-taken items by `score` and append what fits. */
    const fill = (score: (text: string) => number, alwaysGuess: boolean) => {
        const room = limit - rows.length;
        if (room <= 0) return;
        items
            .filter((item) => !taken.has(idOf(item)))
            .map((item) => ({ item, score: score(texts.get(item) ?? "") }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, room)
            .forEach(({ item, score }) => {
                const id = idOf(item);
                taken.add(id);
                rows.push(item);
                if (alwaysGuess || isWeakScore(score)) guessIds.add(id);
            });
    };

    fill((text) => scoreSearchText(text, q), false);

    if (opts.fallback && !rows.some((item) => !guessIds.has(idOf(item)))) {
        fill((text) => looseScoreText(text, q), true);
        fill((text) => overlapScoreText(text, q), true);
    }

    return { rows, guessIds };
}

/**
 * Does this text identify exactly one product — a scanned barcode or a SKU
 * typed in full? A scanner sends the code and then Enter, and Enter must land
 * THAT product, not whichever row the highlight happens to sit on. Ranking
 * alone is not enough of a guarantee when a wrong item on a purchase bill is
 * the cost of being wrong.
 *
 * Deliberately exact and case-insensitive only — no prefix, no fuzz.
 */
export function findByExactCode<T extends { sku?: string | null; codes?: readonly { value: string }[] | null }>(
    items: readonly T[],
    query: string,
): T | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
        items.find(
            (p) =>
                (p.sku ?? "").toLowerCase() === q ||
                (p.codes ?? []).some((c) => c.value.toLowerCase() === q),
        ) ?? null
    );
}
