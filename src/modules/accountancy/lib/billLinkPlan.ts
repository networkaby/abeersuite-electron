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

/** Ticked bills → the amount placed on each (spine id → ₹). */
export type BillPicks = Record<number, number>;

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
    /** How much of THIS bill is already settled by the one voucher being linked
     *  — only filled when the caller named that voucher (`excludeId`). The link
     *  save states the pair's total, so the client needs to know what it already
     *  is; without it, re-opening the popup would offer to link the same money
     *  a second time. */
    linkedHere?:        number;
};

export function sideOf(signed: number): LinkSide {
    if (signed > EPS) return 1;
    if (signed < -EPS) return -1;
    return 0;
}

/**
 * When a bill falls due: its own date plus the credit period agreed on it, or
 * the house default when the document does not say.
 *
 * One definition, because there were four — `billLink` twice and `outstandings`
 * twice — and all of them stepped the date with local-time `setDate()` on a
 * value that is UTC midnight, which lands on the previous day anywhere west of
 * UTC. Whole days are added in UTC here, so the answer does not depend on where
 * the machine thinks it is.
 */
export function dueDateOf(date: Date | string, creditPeriodDays?: number | null): Date {
    const base = date instanceof Date ? date : new Date(date);
    return new Date(base.getTime() + (creditPeriodDays ?? DEFAULT_DUE_DAYS) * 86_400_000);
}

/** Total money placed by a set of ticks. */
export function sumPicks(picks: BillPicks): number {
    return round2(Object.values(picks).reduce((s, n) => s + n, 0));
}

/**
 * The order Auto settles bills in, in the owner's words: "kill overdue, then
 * nearest due date, for same due date lowest amount".
 *
 * All three fall out of ONE sort. An overdue bill's due date is in the past, so
 * sorting by due date puts the longest overdue first and then walks forward to
 * the ones not yet due — no separate overdue bucket is needed. A tie goes to the
 * SMALLER bill, which closes more bills with the same money.
 *
 * Note this is deliberately not the order the ageing report calls "most
 * overdue": that one still counts days from the bill date. They agree for
 * everything on the house default and differ only where a bill carries its own
 * credit period.
 */
export function autoLinkOrder<T extends { dueDate: string; open: number; universalVoucherId: number }>(
    docs: T[],
): T[] {
    return [...docs].sort((a, b) => {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
        if (Math.abs(a.open - b.open) > EPS) return a.open - b.open;
        return a.universalVoucherId - b.universalVoucherId;
    });
}

/** The id a party's opening balance carries while it is still a bare figure on
 *  the master with no voucher behind it. Negative, so it can never collide with
 *  a real spine id; the caller turns it into a real opening bill before saving
 *  anything against it. */
export const OPENING_SCALAR_ID = -1;

/** One voucher's worth of links: what it settles, and by how much. */
export type LinkPlanFor = {
    /** The settling voucher. `null` = the one the user has open, which does not
     *  exist yet at planning time. */
    sourceId: number | null;
    links:    { universalVoucherId: number; amount: number }[];
};

/**
 * Who pays which bill, when the money comes from more than one place.
 *
 * A party's own credits — an advance they left, a sale return, an unlinked
 * receipt — are money already sitting with us, and they can close bills just as
 * the voucher in hand can. Letting them into the same settlement is what lets
 * ₹10,000 received close ₹11,000 of bills when ₹1,000 was already lying there:
 * the receipt's amount does not grow, the number of bills it can clear does.
 *
 * `targets` are the references being settled (each with the amount to place on
 * it) and `credits` the same-side references being spent. The voucher in hand
 * pays first and the credits follow, each in `autoLinkOrder`, so the same ticks
 * always produce the same links — and every link is still one ordinary pair of
 * opposite-side vouchers, which is the only kind the books allow.
 */
export function assignSources(
    targets: { id: number; amount: number }[],
    ownBudget: number,
    credits: { id: number; amount: number }[],
): LinkPlanFor[] {
    const out = new Map<number | null, { universalVoucherId: number; amount: number }[]>();
    const sources: { id: number | null; left: number }[] = [
        { id: null, left: round2(ownBudget) },
        ...credits.map((c) => ({ id: c.id, left: round2(c.amount) })),
    ];

    let s = 0;
    for (const t of targets) {
        let need = round2(t.amount);
        while (need > EPS && s < sources.length) {
            const src = sources[s];
            if (src.left <= EPS) { s += 1; continue; }
            const take = round2(Math.min(need, src.left));
            const list = out.get(src.id) ?? [];
            list.push({ universalVoucherId: t.id, amount: take });
            out.set(src.id, list);
            src.left = round2(src.left - take);
            need = round2(need - take);
        }
    }
    return [...out.entries()].map(([sourceId, links]) => ({ sourceId, links }));
}

/**
 * Cut a set of ticks down to what the bills can still take.
 *
 * Ticks outlive the list they were made against: the side panel's ticks travel
 * into the popup, which loads the party's bills again, and in between a bill can
 * be settled by someone else, cancelled, or simply no longer be offered. An
 * unknown tick used to be counted in the total on screen and then silently
 * dropped on save — the user read "₹5,000 linked" and ₹3,000 was saved. Now it
 * is dropped or trimmed out loud, and the caller can say which.
 */
export function reconcilePicks(
    docs: LinkableDoc[],
    picks: BillPicks,
): { picks: BillPicks; clamped: number[] } {
    const openById = new Map(docs.map((d) => [d.universalVoucherId, d.open]));
    const clamped: number[] = [];
    const out: BillPicks = {};

    for (const [key, value] of Object.entries(picks)) {
        const id = Number(key);
        const room = openById.get(id);
        if (room === undefined) { clamped.push(id); continue; }
        const kept = round2(Math.min(value, room));
        if (kept <= EPS) { clamped.push(id); continue; }
        if (kept < round2(value) - EPS) clamped.push(id);
        out[id] = kept;
    }
    return { picks: out, clamped };
}

/**
 * Turn "here is ₹X to place" into the full set of ticks it should end up as.
 *
 * Serves both halves of the popup, so the save path never has to care which the
 * user used:
 *
 *   • tick-list — pass `pickedIds`, and only those documents are filled, in the
 *     order `docs` is already in;
 *   • Auto — pass the ticks the user already made as `existing`, and it fills
 *     the REMAINDER around them in `autoLinkOrder`.
 *
 * Auto never overrides a manual choice: an existing tick is carried through
 * untouched and its money is taken out of the budget first. The one exception is
 * a tick that no longer fits — the bill has gone, or someone else settled it in
 * the meantime — which is clamped down (or dropped) and named in `clamped`, so
 * the screen can say so instead of the save failing with a refusal the user
 * cannot explain.
 *
 * Whatever is left over is not an error: it simply stays as the party's advance,
 * which is what an unlinked receipt already is — a reference a later bill can be
 * settled against.
 */
export function planLinks(
    docs: LinkableDoc[],
    amount: number,
    opts: {
        /** Only these bills may be filled. */
        pickedIds?: number[];
        /** Ticks already made by hand — kept as they are, and paid for first. */
        existing?:  BillPicks;
        /** Defaults to the priority order for Auto, and to the list's own order
         *  when the caller named the bills. */
        order?:     "auto" | "listed";
    } = {},
): { picks: BillPicks; clamped: number[] } {
    // Carry the manual ticks through first, cut to what each bill can still take.
    const { picks, clamped } = reconcilePicks(docs, opts.existing ?? {});

    // The budget is what is left of the whole amount — measured against every
    // tick, not per bill, or a stale tick would let Auto place the same money
    // twice.
    let left = round2(amount - sumPicks(picks));
    if (left <= EPS) return { picks, clamped };

    const picked = opts.pickedIds ? new Set(opts.pickedIds) : null;
    const order = (opts.order ?? (picked ? "listed" : "auto")) === "listed" ? docs : autoLinkOrder(docs);

    for (const d of order) {
        if (left <= EPS) break;
        const id = d.universalVoucherId;
        if (picked && !picked.has(id)) continue;
        const room = round2(d.open - (picks[id] ?? 0));
        if (room <= EPS) continue;
        const take = round2(Math.min(left, room));
        picks[id] = round2((picks[id] ?? 0) + take);
        left = round2(left - take);
    }
    return { picks, clamped };
}
