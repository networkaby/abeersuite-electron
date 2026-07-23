// ── Customer Quality ──────────────────────────────────────────────────────────
//
// Internal-only staff knowledge about a customer (the customer must NEVER see
// any of this — no portal/shop/print exposure):
//
//   • noDiscount flag  — Person/Company.noDiscount (Boolean). Flagged customer
//     bills at barcode price: tier discount, coupons and loyalty (earn+redeem)
//     are all suppressed server-side, silently. Hard-coded all-block for now.
//   • rating + comments — one append-only timeline in Person/Company.qualityLog
//     (Json). The latest "rating" entry is the current rating.
//   • marketing group  — Person/Company.customerGroupId → CustomerGroup master.
//
// Author identity is denormalised into each entry (name + avatar) so the
// timeline renders without joins; a later avatar change doesn't rewrite logs.

export type QualityLogEntry = {
    type: "rating" | "comment";
    /** 1–5, rating entries only. */
    stars?: number;
    /** Comment text, comment entries only. */
    text?: string;
    authorId: number;
    authorName: string;
    authorAvatarUrl?: string | null;
    /** ISO timestamp of when the entry was made. */
    at: string;
    /** Where the entry was recorded from. */
    source: "pos" | "office";
    /** POS counter name, only when source === "pos". */
    counterNo?: string;
};

/** Storage order is append-only (oldest first); display should reverse. */
export function parseQualityLog(raw: unknown): QualityLogEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (e): e is QualityLogEntry =>
            !!e && typeof e === "object" &&
            ((e as QualityLogEntry).type === "rating" || (e as QualityLogEntry).type === "comment"),
    );
}

/** Latest rating entry = the customer's current rating (1–5), or null. */
export function latestRating(log: QualityLogEntry[]): number | null {
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.type === "rating" && typeof e.stars === "number") return e.stars;
    }
    return null;
}
