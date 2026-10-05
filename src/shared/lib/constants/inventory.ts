/**
 * Stock-movement tuning — how the Reorder screen and BI → FSN judge a product.
 *
 * Code-owned behavioural constants, deliberately NOT DB settings: they define how
 * the engines reason, not per-shop config. Change the numbers here to retune.
 */

/**
 * The Reorder promotion ladder: organic sale days within the slow-band window
 * needed to climb (see `inventory/lib/movementClass.ts`). Falling needs no
 * ladder — recency alone demotes.
 */
export const REORDER_LADDER = {
    /** ≥ this many organic sale days → promote to SLOW (amber checkpoint). */
    toSlowDays: 2,
    /** ≥ this many organic sale days → promote to REGULAR (buy math resumes). */
    toRegularDays: 4,
} as const;

/** Widest history the Reorder classifier reads — beyond this everything is DEAD anyway. */
export const REORDER_HISTORY_DAYS = 365;

/** BI → FSN: qty turnover (out ÷ avg stock) at or above this = Fast mover. */
export const FAST_MIN_TURNOVER = 3;

/** Most shop photos the phone app lets one product hold. The office gallery has no
 *  cap; this stops a phone "pick many" from sending a hundred over mobile data. */
export const MAX_PRODUCT_PHOTOS = 12;
