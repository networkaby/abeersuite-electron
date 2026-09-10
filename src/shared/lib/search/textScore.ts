// ── textScore ───────────────────────────────────────────────────────────────────────
// The tiered text matcher, shared by every search box in the app.
//
// It knows nothing about products or people — it takes a blob of searchable
// text and a query, and says how well they match. Products assemble their text
// from name/SKU/brand/codes (`productSearchText`); parties assemble theirs from
// name/phones/address/aliases (`partySearchText`). Both then rank identically,
// so "papera4" and "medhidura" are the same trick applied to different rows.
//
// Three strengths, weakest last. A caller runs them in order and stops at the
// first that finds something real:
//
//   scoreSearchText   every token must match. The real search.
//   looseScoreText    no token mandatory, tiers add up, wider typo budget.
//   overlapScoreText  letter-pair closeness. Never blank, never trustworthy.

/** Split searchable text into individual words for fuzzy matching. */
function textWords(text: string): string[] {
    return text.split(/\s+/).filter(Boolean);
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
    // A short token must NOT be fuzzy-matched. One edit out of two characters
    // is a 50% error rate, and it matches nearly anything: "a4" reached the
    // bare word "a" in a product description and pulled a camera into a search
    // for A4 paper. Below MIN_FUZZY_LEN a token has to match for real.
    if (token.length >= MIN_FUZZY_LEN && fuzzyMax > 0) {
        const budget = token.length >= 5 ? fuzzyMax : Math.min(fuzzyMax, 1);
        if (words.some((w) => editDistanceAtMost(token, w, budget))) return TIER_TYPO;
    }
    return 0;
}

/** Shortest piece a split is allowed to produce — below this nearly every
 *  product matches and the rescue turns into noise. */
const MIN_SPLIT_PIECE = 2;

/** Shortest token allowed a fuzzy (typo) match — see tokenTier. */
const MIN_FUZZY_LEN = 4;

/**
 * Rescue for a token the cashier ran together: "pen32", "a4paper", "papera4",
 * "camcp". Tries every two-way split, scores both halves with the normal
 * ladder, and keeps the best — worst half wins within a split, demoted one
 * tier so it never outranks a genuine match. 0 when no split works.
 */
function splitTokenTier(token: string, text: string): number {
    if (token.length < MIN_SPLIT_PIECE * 2) return 0;
    // Both halves must land at a WORD BOUNDARY, and neither may be fuzzy.
    // Splitting is already a guess about what the operator meant; letting a
    // half match mid-word or through a typo stacks guess on guess and the
    // result matches almost anything. "paper" split to "pa" + "per" found
    // both inside "com(pa)tible" and "o(per)ates" — a camera, in a search for
    // A4 paper. A real run-together query does not need the slack: "pen32",
    // "a4paper", "papera4" and "camcp" all split into halves that begin words.
    const startsWord = (piece: string) => {
        const idx = text.indexOf(piece);
        return idx === 0 || (idx > 0 && text[idx - 1] === " ");
    };
    for (let i = MIN_SPLIT_PIECE; i <= token.length - MIN_SPLIT_PIECE; i++) {
        if (startsWord(token.slice(0, i)) && startsWord(token.slice(i))) {
            return demoteTier(TIER_WORD_START);
        }
    }
    return 0;
}

/** scoreProductSearch over text the caller assembled itself. */
export function scoreSearchText(text: string, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q) return 1;
    if (!text) return 0;

    // Bonus when the full query appears as a contiguous substring
    const fullBonus = text.includes(q) ? FULL_QUERY_BONUS : 0;

    const words = textWords(text);
    let tier = 0; // worst tier across all tokens (lower = worse)

    for (const token of q.split(/\s+/).filter(Boolean)) {
        // Whole token first — unchanged ranking for everything that already
        // matched. Only a token that scores nothing gets the split rescue.
        const hit = tokenTier(token, text, words, 1) || splitTokenTier(token, text);
        if (!hit) return 0; // token not found at all
        tier = Math.max(tier, hit);
    }
    return tier + fullBonus;
}

/** looseProductScore over text the caller assembled itself. */
export function looseScoreText(text: string, query: string): number {
    const q = query.trim().toLowerCase();
    if (!q || !text) return 0;

    const words = textWords(text);
    let total = 0;
    for (const token of q.split(/\s+/).filter(Boolean)) {
        const hit = tokenTier(token, text, words, 2) || splitTokenTier(token, text);
        total += hit / 10; // same ladder, scaled down: 400 → 40 … 10 → 1
    }
    return total;
}

/** rawOverlapScore over text the caller assembled itself. */
export function overlapScoreText(text: string, query: string): number {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q || !text) return 0;
    if (q.length < 2) return text.includes(q) ? 1 : 0;
    let hits = 0;
    for (let i = 0; i < q.length - 1; i++) if (text.includes(q.slice(i, i + 2))) hits++;
    return hits / (q.length - 1);
}
