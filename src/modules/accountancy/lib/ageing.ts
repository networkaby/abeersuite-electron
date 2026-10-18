// How the four ageing periods are worded and coloured — shared by every screen
// that shows outstandings, so a period reads the same on the Receivables and
// Payables reports and inside a party's own Outstanding tab.
//
// AGEING_DAYS is the one place the period boundaries live: the bucketing on the
// server (`bucketFor`, used by ./outstandings.ts), the period labels and a bill's
// "Within / Overdue" status all read it, so they can never disagree.

import type { AgeingBucket } from "./outstandings";

/** Period boundaries in days — 0–30, 30–60, 60–90, 90+. The first one is also a
 *  bill's credit window: past it, the bill counts as overdue. */
export const AGEING_DAYS = [30, 60, 90] as const;
const [D1, D2, D3] = AGEING_DAYS;

export const BUCKET_LABELS = {
    b0_30:    `0–${D1} days`,
    b30_60:   `${D1}–${D2} days`,
    b60_90:   `${D2}–${D3} days`,
    b90_plus: `${D3}+ days`,
} as const satisfies Record<AgeingBucket, string>;

/** Which period a bill `days` old falls in. */
export function bucketFor(days: number): AgeingBucket {
    if (days <= D1) return "b0_30";
    if (days <= D2) return "b30_60";
    if (days <= D3) return "b60_90";
    return "b90_plus";
}

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
    return daysOverdue <= D1 ? `Within ${D1 - daysOverdue}d` : `Overdue ${daysOverdue - D1}d`;
}

/** The colour that status wears on a bill row. A bill still inside its month is
 *  dimmed — nothing is wrong with it yet — where the period cards always speak
 *  in the period's own colour. Overdue rows match the cards. */
export function ageingStatusClass(bucket: AgeingBucket): string {
    return bucket === "b0_30" ? "text-muted-foreground" : BUCKET_COLORS[bucket];
}
