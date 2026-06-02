export {
    ratesFromConfig,
    buildRulesIndex,
    resolveEarnMultiplier,
    earnableBaseForCart,
    resolveRedeemCapPct,
    redeemableBaseForCart,
    pointsForBase,
    redeemValueOf,
    clampRedemption,
    expiryCutoff,
} from "./loyaltyMath";
export type { LoyaltyRates, EarnRule, EarnLine, RulesIndex, TaxonomyMaps } from "./loyaltyMath";

export {
    applyLoyaltyForSale,
    reverseLoyaltyForReturn,
    adjustPoints,
    applyMilestones,
    liveBalance,
} from "./applyLoyalty";
export type { ApplySaleArgs, ReverseReturnArgs, MilestoneTier, AwardMilestonesArgs } from "./applyLoyalty";
