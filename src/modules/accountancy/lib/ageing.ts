// How the four ageing periods are worded and coloured — shared by every screen
// that shows outstandings, so a period reads the same on the Receivables and
// Payables reports and inside a party's own Outstanding tab.
//
// TODO(config): the four periods are fixed at 30 / 60 / 90 days today — the
// boundaries live in `bucketFor()` in ./outstandings.ts. They are to become
// configurable under /office/settings, after which both the bucketing and these
// labels must read from that config instead.

import type { AgeingBucket } from "./outstandings";

export const BUCKET_LABELS = {
    b0_30:    "0–30 days",
    b30_60:   "30–60 days",
    b60_90:   "60–90 days",
    b90_plus: "90+ days",
} as const satisfies Record<AgeingBucket, string>;

export const BUCKET_COLORS = {
    b0_30:    "text-foreground",
    b30_60:   "text-amber-600",
    b60_90:   "text-orange-600",
    b90_plus: "text-red-600",
} as const satisfies Record<AgeingBucket, string>;

/** The four keys in ageing order — oldest money last. */
export const BUCKET_KEYS = Object.keys(BUCKET_LABELS) as AgeingBucket[];

/** A bill's age said in words: still inside its month, or how far past it. */
export function ageingStatusLabel(daysOverdue: number): string {
    return daysOverdue <= 30 ? `Within ${30 - daysOverdue}d` : `Overdue ${daysOverdue - 30}d`;
}

/** The colour that status wears on a bill row. A bill still inside its month is
 *  dimmed — nothing is wrong with it yet — where the period cards always speak
 *  in the period's own colour. Overdue rows match the cards. */
export function ageingStatusClass(bucket: AgeingBucket): string {
    return bucket === "b0_30" ? "text-muted-foreground" : BUCKET_COLORS[bucket];
}
