/**
 * Secret price-date code — printed vertically down the edge of a barcode label.
 *
 *   MM → 2-digit month (01–12)
 *   B  → 5-day bucket of the month: 1 = 1–5, 2 = 6–10, 3 = 11–15,
 *        4 = 16–20, 5 = 21–25, 6 = 26–end
 *
 * e.g. 2026-05-14 → "053" (May, days 11–15).
 *
 * Staff can read how old a printed price is; the customer sees three digits that
 * mean nothing. The last bucket carries the month's remainder (26–28/29/30/31)
 * rather than giving the 31st a bucket of its own — a one-day code would be read
 * as stale stock far too easily.
 *
 * Source date: InvProduct.salePriceFrozenAt, which is the age of the PRINTED
 * BARCODE PRICE (manual or auto) — re-stamped only when that ₹ moves. See
 * modules/pricing-strategy/lib/barcodeDate.ts.
 */

/** Days per bucket. */
export const SECRET_BUCKET_DAYS = 5;

/** Buckets in a month — the last one absorbs the remainder (26–end). */
export const SECRET_BUCKET_COUNT = 6;

/** 5-day bucket of the month: 1 (1–5) … 6 (26–end). */
export function secretBucket(day: number): number {
    return Math.min(SECRET_BUCKET_COUNT, Math.ceil(day / SECRET_BUCKET_DAYS));
}

/**
 * Build the code from a "YYYY-MM-DD" string. Parsed from the string directly (no
 * Date object) so there are no timezone surprises. "" for an empty/invalid date.
 */
export function secretDateCode(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr ?? "").trim());
    if (!m) return "";
    const day = parseInt(m[3], 10);
    if (day < 1 || day > 31) return "";
    return `${m[2]}${secretBucket(day)}`;
}

const BUCKET_LABEL = [
    "", "days 1–5", "days 6–10", "days 11–15", "days 16–20", "days 21–25", "days 26–end",
];

/** Human reading of a bucket digit, for the staff-facing table ("days 11–15"). */
export const secretBucketLabel = (bucket: number): string => BUCKET_LABEL[bucket] ?? "";
