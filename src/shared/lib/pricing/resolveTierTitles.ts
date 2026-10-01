import { round2 } from "@/shared/lib/format";

// Spend-tier resolution — the ONE place that turns periods + spend into titles and a
// discount %. Pure, so the POS can run it live on every keystroke and /api/pos/sale can
// re-run it server-side to decide what the bill actually gets. Both must agree: the POS
// number is computed in a browser and cannot be trusted on its own.

export interface TierLevelInput {
    name: string;
    minSpend: number;
    /** Discount % this level earns. Periods apply independently, so these sum. */
    discountPct: number;
}

/** Who the current bill counts for. Mirrors the TierCurrentSaleScope enum. */
export type TierCurrentSaleScope = "NONE" | "NEW" | "RETURNING" | "ALL";

export interface TierPeriodInput {
    id: number;
    name: string;
    /** Whether the current bill is added on top of `spend`, and for whom. */
    currentSaleScope: TierCurrentSaleScope;
    /** Score ONLY the current bill — `spend`, fromDay and toDay are all ignored. */
    currentSaleOnly: boolean;
    fromDay: number;
    toDay: number;
    /** Posted ledger spend inside the bracket. */
    spend: number;
    /** Enabled levels, pre-sorted minSpend DESC — the first one cleared is the highest. */
    levels: TierLevelInput[];
}

export interface TierTitle {
    periodId: number;
    periodName: string;
    fromDay: number;
    toDay: number;
    /** The spend that earned it — bracket spend, plus the current bill when counted. */
    spend: number;
    /** True when the current bill is part of `spend`. */
    includesCurrentSale: boolean;
    levelName: string;
    discountPct: number;
}

export interface TierResult {
    titles: TierTitle[];
    /** Sum of every title's % before the guard. */
    rawPct: number;
    /** What the bill gets: rawPct capped by the guard and a hard 100. */
    discountPct: number;
    capPct: number | null;
    cappedByGuard: boolean;
    /** Rank score — Σ the % of every title held (scored periods only). */
    score: number;
    /** Best score the current settings allow — Σ each scored period's top level %. */
    maxScore: number;
    /** Overall rank from score ÷ maxScore, "" when no title is held. See RANK_BANDS. */
    badgeLevelName: string;
}

// Overall rank bands, as a share of maxScore. A share (not fixed numbers) so the
// ladder follows the settings page: delete or retune a level and the bands move too.
const RANK_BANDS = [
    { name: "Platinum", from: 0.75 },
    { name: "Gold",     from: 0.5 },
    { name: "Silver",   from: 0.25 },
    { name: "Bronze",   from: 0 },
] as const;

/**
 * Does this period count the bill on the counter for this customer?
 *
 * The current bill is today, so a bracket must start at day 0 to contain it — a 30-90
 * slice set to count it must not pick it up. A currentSaleOnly period has no bracket at
 * all, so that rule doesn't apply to it.
 */
export const countsCurrentSale = (
    p: { currentSaleScope: TierCurrentSaleScope; currentSaleOnly: boolean; fromDay: number },
    isNewCustomer: boolean,
) => {
    if (!p.currentSaleOnly && p.fromDay !== 0) return false;
    switch (p.currentSaleScope) {
        case "ALL":       return true;
        case "NEW":       return isNewCustomer;
        case "RETURNING": return !isNewCustomer;
        default:          return false;
    }
};

/**
 * Resolve every title a customer holds and the discount they add up to.
 *
 * `currentSaleValue` is the bill on the counter **before any discount**, added on top of
 * posted spend for periods that count it. It has to be pre-discount: the discount is what
 * we are computing, so feeding the discounted total back in would be circular. Pass 0
 * when there is no bill (the account snapshot at rest).
 *
 * `isNewCustomer` = no posted bill yet (turnover.invoiceCount === 0), which is what the
 * NEW / RETURNING scopes key off.
 */
export function resolveTierTitles(args: {
    periods: TierPeriodInput[];
    currentSaleValue: number;
    isNewCustomer: boolean;
    capPct: number | null;
}): TierResult {
    const { periods, currentSaleValue, isNewCustomer, capPct } = args;

    const titles = periods.flatMap<TierTitle>((p) => {
        const counts = countsCurrentSale(p, isNewCustomer);
        const includesCurrentSale = counts && currentSaleValue > 0;
        // currentSaleOnly drops the bracket, which is what seals a scoped period: a
        // customer the scope excludes contributes nothing and has no history to fall back
        // on, so they score 0 and earn no title.
        const history = p.currentSaleOnly ? 0 : p.spend;
        const spend = history + (counts ? currentSaleValue : 0);
        const level = p.levels.find((l) => spend >= l.minSpend);
        return level
            ? [{
                periodId:    p.id,
                periodName:  p.name,
                fromDay:     p.fromDay,
                toDay:       p.toDay,
                spend,
                includesCurrentSale,
                levelName:   level.name,
                discountPct: level.discountPct,
            }]
            : [];
    });

    const rawPct = round2(titles.reduce((sum, t) => sum + t.discountPct, 0));
    // Tier and the cap are both a % of the same goods value, so capping the % caps the
    // rupees — no bill total needed here. Coupons are clamped later against what is left.
    const discountPct = Math.min(100, capPct ?? 100, rawPct);

    // Rank = weighted score: each title counts its own %, so recent brackets (which
    // pay more) weigh more. A currentSaleOnly period is a first-bill offer, not
    // history, so it is left out of both sides of the ratio.
    const scored = periods.filter((p) => !p.currentSaleOnly);
    const scoredIds = new Set(scored.map((p) => p.id));
    const score = round2(titles.filter((t) => scoredIds.has(t.periodId)).reduce((sum, t) => sum + t.discountPct, 0));
    const maxScore = round2(scored.reduce((sum, p) => sum + Math.max(0, ...p.levels.map((l) => l.discountPct)), 0));
    const share = maxScore > 0 ? score / maxScore : 0;
    const rank = score > 0 ? RANK_BANDS.find((b) => share >= b.from)!.name : "";

    // Medals — newest bracket first, so they read as history left to right. By
    // fromDay, never sortOrder, so re-ordering the settings page moves nothing.
    titles.sort((a, b) => a.fromDay - b.fromDay);

    return {
        titles,
        rawPct,
        discountPct,
        capPct,
        cappedByGuard: discountPct < rawPct,
        score,
        maxScore,
        badgeLevelName: rank,
    };
}
