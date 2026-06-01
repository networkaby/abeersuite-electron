export {
    ratesFromConfig,
    buildRulesIndex,
    resolveEarnMultiplier,
    earnableBaseForCart,
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
    liveBalance,
} from "./applyLoyalty";
export type { ApplySaleArgs, ReverseReturnArgs } from "./applyLoyalty";
