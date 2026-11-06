/**
 * Ordering and "Did you mean" for the storefront search. Which products match
 * stays `matchesQuery` (catalogFilters.ts) — strict on purpose, a storefront
 * never shows things the shopper did not ask for. This file only decides the
 * order of those matches, and, when nothing matches, offers a corrected
 * spelling as a link the shopper chooses to follow.
 */

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Higher = better. The title starting with the search beats the title holding
 * every word, which beats a match found only in the category or description.
 */
export function searchRelevance(p: { displayName: string; category: string }, q: string): number {
    const term = q.trim().toLowerCase();
    if (!term) return 0;
    const title = p.displayName.toLowerCase();
    const titleWords = words(title);
    const qWords = words(term);
    let score = 0;
    if (title.startsWith(term)) score += 100;
    else if (title.includes(term)) score += 60;
    const inTitle = qWords.filter((w) => titleWords.some((t) => t.startsWith(w))).length;
    score += qWords.length ? Math.round((inTitle / qWords.length) * 40) : 0;
    if (p.category.toLowerCase().includes(term)) score += 15;
    return score;
}

/** Edit distance with an early stop once it passes `max`. */
function distance(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            cur.push(v);
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

/**
 * "logitec mous" → "logitech mouse", from the words actually used in the
 * catalogue. Each misspelt word is swapped for the closest catalogue word
 * (1 edit for short words, 2 for longer); null when nothing would change.
 */
export function didYouMean(q: string, catalogueText: string[]): string | null {
    const qWords = words(q);
    if (qWords.length === 0) return null;
    const freq = new Map<string, number>();
    for (const t of catalogueText) for (const w of words(t)) if (w.length > 2) freq.set(w, (freq.get(w) ?? 0) + 1);
    let changed = false;
    const fixed = qWords.map((w) => {
        if (freq.has(w) || w.length < 3) return w;
        const max = w.length <= 4 ? 1 : 2;
        let best: string | null = null;
        let bestD = max + 1;
        let bestF = 0;
        for (const [cand, f] of freq) {
            const d = distance(w, cand, max);
            if (d < bestD || (d === bestD && f > bestF)) {
                best = cand;
                bestD = d;
                bestF = f;
            }
        }
        if (best && bestD <= max) {
            changed = true;
            return best;
        }
        return w;
    });
    return changed ? fixed.join(" ") : null;
}
