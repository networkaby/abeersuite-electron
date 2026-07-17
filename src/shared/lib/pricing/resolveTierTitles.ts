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
    /** Title shown on the customer badge — see badge ordering below. */
    badgePeriodId: number | null;
    badgeLevelName: string;
}

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

    // Badge = the tightest bracket held. Ranked by toDay, never by sortOrder, so
    // re-ordering the settings page cannot move a customer's badge.
    const badge = titles.reduce<TierTitle | null>(
        (best, t) => (best === null || t.toDay < best.toDay ? t : best),
        null,
    );

    return {
        titles,
        rawPct,
        discountPct,
        capPct,
        cappedByGuard: discountPct < rawPct,
        badgePeriodId: badge?.periodId ?? null,
        badgeLevelName: badge?.levelName ?? "",
    };
}
