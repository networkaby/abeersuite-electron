export {
    ratesFromConfig,
    buildRulesIndex,
    resolveEarnMultiplier,
    earnableBaseForCart,
    pointsForBase,
    redeemValueOf,
    clampRedemption,
} from "./loyaltyMath";
export type { LoyaltyRates, EarnRule, EarnLine, RulesIndex, TaxonomyMaps } from "./loyaltyMath";

export {
    applyLoyaltyForSale,
    reverseLoyaltyForReturn,
    adjustPoints,
    expireLots,
} from "./applyLoyalty";
export type { ApplySaleArgs, ReverseReturnArgs } from "./applyLoyalty";
