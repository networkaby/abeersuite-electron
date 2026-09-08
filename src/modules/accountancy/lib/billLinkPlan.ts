// Bill-wise link planning — the pure half of `billLink.ts`.
//
// Split out so the popup can import it: everything here is plain arithmetic with
// no database behind it, which keeps Prisma out of the client bundle. The server
// half (`billLink.ts`) re-exports these, so server callers need only one import.

import { round2 } from "@/shared/lib/format/moneyInr";

/** Money smaller than this is treated as nothing (paisa rounding noise). */
export const EPS = 0.005;

/** Days a bill is given before it counts as due, when the bill itself says nothing. */
export const DEFAULT_DUE_DAYS = 30;

/** +1 = they owe us (receivable) · −1 = we owe them (payable) · 0 = no party leg. */
export type LinkSide = 1 | -1 | 0;

/** One document a party can settle, or be settled by. */
export type LinkableDoc = {
    universalVoucherId: number;
    voucherType:        string;
    ref:                string;
    date:               string;
    dueDate:            string;
    side:               1 | -1;
    /** Display total (the bill's face value), for showing next to `open`. */
    face:               number;
    linked:             number;
    open:               number;
};

export function sideOf(signed: number): LinkSide {
    if (signed > EPS) return 1;
    if (signed < -EPS) return -1;
    return 0;
}

/**
 * Turn "here is ₹X to place" into a list of links.
 *
 * Serves both halves of the popup, so the save path never has to care which the
 * user used:
 *
 *   • tick-list — pass `pickedIds`, and only those documents are filled, in the
 *     order `docs` is already in (oldest first);
 *   • Auto — omit `pickedIds`, and it walks every open document oldest-first
 *     until the money runs out.
 *
 * Whatever is left over is not an error: it simply stays as the party's advance,
 * which is what an unlinked receipt already means.
 */
export function planLinks(
    docs: LinkableDoc[],
    amount: number,
    pickedIds?: number[],
): { universalVoucherId: number; amount: number }[] {
    const picked = pickedIds ? new Set(pickedIds) : null;
    let left = round2(amount);
    const out: { universalVoucherId: number; amount: number }[] = [];

    for (const d of docs) {
        if (left <= EPS) break;
        if (picked && !picked.has(d.universalVoucherId)) continue;
        const take = round2(Math.min(left, d.open));
        if (take <= EPS) continue;
        out.push({ universalVoucherId: d.universalVoucherId, amount: take });
        left = round2(left - take);
    }
    return out;
}
