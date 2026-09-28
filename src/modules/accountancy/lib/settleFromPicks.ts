"use client";

// Carrying out the settlement the side panel drew up.
//
// The panel lets the user tick anything the party has open, in either direction,
// because that is how a settlement really reads: the bills being closed, and the
// money closing them — which is the voucher just entered PLUS any credit already
// lying with the party (an advance, a return, an unlinked receipt). ₹10,000
// received can close ₹11,000 of bills when ₹1,000 was already there.
//
// The books do not have a "settlement" record, though. They have one kind of
// fact: ₹X of voucher A settles voucher B, between two POSTED vouchers on
// opposite sides. So the plan is taken apart into exactly those facts —
// `assignSources` decides who pays which bill — and each paying voucher posts its
// own set of links. Nothing new is invented in the ledger.
//
// Two things are made real before any of that:
//   • an opening balance still sitting as a bare figure on the master becomes an
//     actual opening bill, so there is something to link to at all;
//   • what each pair is ALREADY linked for is read back, because the link API
//     states the pair's total rather than what to add — which is what makes a
//     repeat of this whole routine change nothing.

import axios from "axios";
import { round2 } from "@/shared/lib/format/moneyInr";
import {
    assignSources, autoLinkOrder, OPENING_SCALAR_ID, EPS,
    type BillPicks, type LinkableDoc,
} from "./billLinkPlan";

/** What a settlement actually did, for the message the user sees. */
export type SettlementResult = {
    /** Bills closed or reduced. */
    bills:   number;
    /** Total placed on them. */
    placed:  number;
    /** How much of that came from credits the party already had with us. */
    credits: number;
    /** Set when an opening balance had to become a real bill first. */
    openingBillId?: number;
};

async function loadDocs(accountId: number, excludeId?: number): Promise<LinkableDoc[]> {
    const params = new URLSearchParams({ accountId: String(accountId) });
    if (excludeId !== undefined) params.set("excludeId", String(excludeId));
    const { data } = await axios.get<{ docs: LinkableDoc[] }>(
        `/api/accountancy/allocations/open?${params.toString()}`,
    );
    return data.docs;
}

/**
 * Turn a panel's ticks into links, once the voucher is posted.
 *
 * `side` is the side of the party's book this voucher settles: +1 for a Receipt
 * (bills they owe us), −1 for a Payment. A tick on that side is a bill being
 * closed; a tick on the other side is a credit being spent.
 */
export async function settleFromPicks(args: {
    accountId: number;
    /** The voucher just posted — the one whose money is being placed. */
    voucherId: number;
    side:      1 | -1;
    picks:     BillPicks;
    /** The voucher's own amount, when the ticks may have run ahead of it — a
     *  Payment whose amount is a note count, ticked before the count ended.
     *  Links past it are left off, last bill first; ticked credits are still
     *  spent in full. Omitted → the ticks are taken as they stand. */
    maxOwn?:   number;
}): Promise<SettlementResult | null> {
    const picks: BillPicks = { ...args.picks };

    // ── An opening balance with no voucher behind it becomes one ───────────
    let openingBillId: number | undefined;
    const openingAmount = picks[OPENING_SCALAR_ID];
    delete picks[OPENING_SCALAR_ID];
    if (openingAmount !== undefined && openingAmount > EPS) {
        const { data: state } = await axios.get<{
            scalarOpening: number | null;
            scalarOpeningType: "DEBIT" | "CREDIT" | null;
            defaults: { ref: string; date: string };
        }>(`/api/accountancy/accounts/${args.accountId}/opening-bills`);

        if (state.scalarOpening != null && state.scalarOpeningType != null) {
            // The WHOLE opening becomes the bill, not just the part being settled
            // now — the rest of it stays open against that same reference, which
            // is what an opening bill is for.
            const { data: made } = await axios.put<{ created: number[] }>(
                `/api/accountancy/accounts/${args.accountId}/opening-bills`,
                {
                    type:  state.scalarOpeningType,
                    bills: [{
                        ref:    state.defaults.ref,
                        date:   state.defaults.date,
                        amount: Math.abs(Number(state.scalarOpening)),
                    }],
                },
            );
            openingBillId = made.created?.[0];
            if (openingBillId !== undefined) picks[openingBillId] = openingAmount;
        }
    }

    // ── Which tick is a bill, and which is a credit ────────────────────────
    //
    // The WHOLE party, both sides, deliberately: naming a voucher narrows the
    // answer to the side that voucher can settle, which is right for planning one
    // set of links and wrong for telling a bill from a credit — every credit
    // would simply be missing, and its share of the bill would be loaded back
    // onto the voucher that cannot carry it.
    const docs = await loadDocs(args.accountId);
    const byId = new Map(docs.map((d) => [d.universalVoucherId, d]));

    const targets: { id: number; amount: number; doc: LinkableDoc }[] = [];
    const credits: { id: number; amount: number; doc: LinkableDoc }[] = [];
    for (const [key, value] of Object.entries(picks)) {
        const id = Number(key);
        const doc = byId.get(id);
        const amount = round2(value);
        if (!doc || amount <= EPS) continue;
        (doc.side === args.side ? targets : credits).push({ id, amount, doc });
    }
    if (targets.length === 0) return null;

    // The same order the panel filled them in, so what was on screen is what the
    // links say: overdue first, then nearest due, smaller bill on a tie.
    const ordered = autoLinkOrder(targets.map((t) => t.doc))
        .map((d) => targets.find((t) => t.id === d.universalVoucherId)!)
        .filter(Boolean);
    const orderedCredits = autoLinkOrder(credits.map((c) => c.doc))
        .map((d) => credits.find((c) => c.id === d.universalVoucherId)!)
        .filter(Boolean);

    const placed = round2(ordered.reduce((s, t) => s + t.amount, 0));
    const fromCredits = round2(orderedCredits.reduce((s, c) => s + c.amount, 0));
    // Whatever the credits do not cover, this voucher does — never more than
    // it is worth. assignSources stops when the money runs out, so a capped
    // budget simply leaves the last bill (in fill order) short.
    const ownBudget = args.maxOwn != null
        ? Math.max(0, Math.min(round2(placed - fromCredits), round2(args.maxOwn)))
        : round2(placed - fromCredits);

    const plans = assignSources(
        ordered.map((t) => ({ id: t.id, amount: t.amount })),
        ownBudget,
        orderedCredits.map((c) => ({ id: c.id, amount: c.amount })),
    );

    // ── One post per paying voucher ────────────────────────────────────────
    for (const plan of plans) {
        const sourceId = plan.sourceId ?? args.voucherId;
        // What this pair already stands at — the API is told the total it should
        // end up at, so running this twice lands on the same figure.
        const here = new Map(
            (await loadDocs(args.accountId, sourceId)).map((d) => [d.universalVoucherId, d.linkedHere ?? 0]),
        );
        const links = plan.links
            .map((l) => ({
                voucherId: l.universalVoucherId,
                amount:    round2((here.get(l.universalVoucherId) ?? 0) + l.amount),
            }))
            .filter((l) => l.amount > EPS);
        if (links.length === 0) continue;

        await axios.post("/api/accountancy/allocations", {
            accountId: args.accountId,
            voucherId: sourceId,
            links,
        });
    }

    // Read back from the plan, so a capped budget reports what was really linked.
    const linkedBills = new Set(plans.flatMap((p) => p.links.map((l) => l.universalVoucherId)));
    const linked = round2(plans.reduce((s, p) => s + p.links.reduce((t, l) => t + l.amount, 0), 0));
    return { bills: linkedBills.size, placed: linked, credits: fromCredits, openingBillId };
}
