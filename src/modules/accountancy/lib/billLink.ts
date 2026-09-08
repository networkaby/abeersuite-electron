// ── billLink — the one home for bill-wise voucher linking ────────────────────
//
// A link (one `VoucherAllocation` row) says: "₹X of this voucher settles that
// voucher". Tally calls it Against Ref. It moves no money and posts NO GL — it
// only says which bill the money that already moved belongs to.
//
// The whole feature rests on ONE idea: never ask "what kind of voucher is this",
// read the PARTY'S OWN LEG in the ledger instead.
//
//   signedParty(v) = Σ(debits on the party ledger) − Σ(credits on it)
//   side(v)        = sign(signedParty)   +1 receivable · −1 payable · 0 not a party voucher
//   linked(v)      = Σ links touching v, on EITHER side, whose other end is alive
//   open(v)        = |signedParty| − linked(v)
//
// Everything the owner asked for falls out of that with no special cases:
//
//   • Cross-voucher — a link is legal when both vouchers touch the SAME party
//     ledger with OPPOSITE non-zero signs. Nothing is hardcoded per voucher kind.
//   • Purchase settled against a sale — a purchase is simply the −1 side of the
//     same party, so it pairs with a sale exactly like a receipt does. This is
//     why `linked()` counts BOTH sides: the sale is the target, the purchase the
//     source, and both must come down.
//   • Journals — a journal with a party leg has a sign like anything else, so it
//     links with no extra code. A Contra has no party leg → side 0 → never
//     offered, which is correct.
//   • Delete or cancel reopens the counterpart — `linked()` ignores a link whose
//     other end is no longer alive, so the bill goes back to open on its own.
//     No repair job, and it is the only rule that survives a Recycle-Bin
//     restore, which re-inserts the voucher with a FRESH id (so a link keyed on
//     the old id could never be mended).
//
// An unallocated receipt needs no row of its own: with `linked()` symmetric, a
// receipt nobody linked simply still has `open > 0`, and that IS the advance.
// So AGAINST_REF is the only method written; ON_ACCOUNT / ADVANCE / NEW_REF are
// left in the enum for the historical rows only.

import type { Prisma } from "@/generated/prisma/client";
import { round2 } from "@/shared/lib/format/moneyInr";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { ledgerStatusFilterUv } from "./ledgerStatus";
import { partyLedgerIds } from "./accountGroups";
import { EPS, dueDateOf, sideOf, type LinkableDoc } from "./billLinkPlan";

// The pure planning half lives in `billLinkPlan.ts` (no Prisma, so the popup can
// import it). Re-exported here so server callers have one place to import from.
export { planLinks, autoLinkOrder, dueDateOf, sumPicks, sideOf, EPS, DEFAULT_DUE_DAYS } from "./billLinkPlan";
export type { LinkSide, LinkableDoc, BillPicks } from "./billLinkPlan";

/**
 * Only these two shapes are real spine links. The other enum members
 * (INVOICE / JOURNAL_ENTRY) address id spaces that no longer exist — a row
 * carrying them is pre-migration debris and must never net anything out.
 */
const LINK_SHAPE: Prisma.VoucherAllocationWhereInput = {
    targetType: "UNIVERSAL_VOUCHER",
    sourceType: { in: ["VOUCHER", "PAYMENT"] },
};

/** A refusal the caller should show to the user as-is — not a server fault. */
export class BillLinkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BillLinkError";
    }
}

/**
 * The party's signed leg on each voucher that touches `accountId`, keyed by spine
 * id. Debits positive, credits negative, alive vouchers only.
 *
 * This is deliberately the *ledger* amount, not `VoucherDetail.totalAmount`. On a
 * trading voucher the party's AR portion is itself a `role:"TENDER"` GL line
 * carrying the unpaid remainder (`postInvVoucher.ts` — "no implicit remainder
 * math here"), so for a bill this equals total − other tenders. For a receipt, a
 * payment or a journal there is no `totalAmount` at all, and the leg is the only
 * thing there is — which is exactly why the party leg is the primitive.
 *
 * Pass `spineIds` to narrow it; omit to sweep the party's whole history.
 */
export async function loadPartyLegs(
    db: Prisma.TransactionClient,
    accountId: number,
    spineIds?: number[],
): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (spineIds !== undefined && spineIds.length === 0) return out;

    const lines = await db.voucherGlLine.findMany({
        where: {
            accountId,
            ...(spineIds !== undefined ? { universalVoucherId: { in: [...new Set(spineIds)] } } : {}),
            universalVoucher: ledgerStatusFilterUv(),
        },
        select: { universalVoucherId: true, type: true, amount: true },
    });
    for (const l of lines) {
        const delta = l.type === "DEBIT" ? Number(l.amount) : -Number(l.amount);
        out.set(l.universalVoucherId, round2((out.get(l.universalVoucherId) ?? 0) + delta));
    }
    return out;
}

/**
 * Total linked amount against each given spine id — counting links where the
 * voucher is the target OR the source, and only while the voucher on the OTHER
 * side is still alive (POSTED, not cancelled, not soft-deleted).
 *
 * Replaces the old `sumReceiptAllocations` + `sumVoucherAllocations` pair, which
 * had byte-identical bodies, looked at the target side only (so a purchase
 * settled against a sale never came down), and trusted links whose receipt had
 * since been cancelled or hard-deleted — the reason a deleted receipt kept
 * clearing its bill.
 */
export async function sumLinked(
    db: Prisma.TransactionClient,
    spineIds: number[],
): Promise<Record<number, number>> {
    const ids = [...new Set(spineIds)];
    if (ids.length === 0) return {};

    const rows = await db.voucherAllocation.findMany({
        where: {
            ...LINK_SHAPE,
            OR: [{ targetId: { in: ids } }, { sourceId: { in: ids } }],
        },
        select: { targetId: true, sourceId: true, amount: true },
    });
    if (rows.length === 0) return {};

    const ends = new Set<number>();
    for (const r of rows) {
        ends.add(r.targetId);
        ends.add(r.sourceId);
    }
    const aliveRows = await db.universalVoucher.findMany({
        where:  { id: { in: [...ends] }, ...ledgerStatusFilterUv() },
        select: { id: true },
    });
    const alive = new Set(aliveRows.map((v) => v.id));

    const wanted = new Set(ids);
    const out: Record<number, number> = {};
    for (const r of rows) {
        // A self-link nets nothing — it would otherwise count twice below.
        // `parity-harness.ts` creates one on purpose, so this is load-bearing.
        if (r.targetId === r.sourceId) continue;
        const amount = Number(r.amount);
        if (wanted.has(r.targetId) && alive.has(r.sourceId)) {
            out[r.targetId] = round2((out[r.targetId] ?? 0) + amount);
        }
        if (wanted.has(r.sourceId) && alive.has(r.targetId)) {
            out[r.sourceId] = round2((out[r.sourceId] ?? 0) + amount);
        }
    }
    return out;
}

/**
 * Every voucher of this party that still has something open — bills, receipts,
 * payments, credit/debit notes, journals alike — oldest first, so the list is
 * already in FIFO order for the popup's Auto button.
 *
 * `excludeId` drops the voucher doing the linking, so it can never be offered
 * against itself.
 */
export async function loadLinkableDocs(
    db: Prisma.TransactionClient,
    accountId: number,
    opts: { excludeId?: number; side?: 1 | -1 } = {},
): Promise<LinkableDoc[]> {
    const legs = await loadPartyLegs(db, accountId);
    const ids = [...legs.entries()]
        .filter(([id, signed]) => Math.abs(signed) > EPS && id !== opts.excludeId)
        .map(([id]) => id);
    if (ids.length === 0) return [];

    const [spines, details, linked, here] = await Promise.all([
        db.universalVoucher.findMany({
            where:  { id: { in: ids } },
            select: { id: true, type: true, voucherNo: true, date: true },
        }),
        db.voucherDetail.findMany({
            where:  { universalVoucherId: { in: ids } },
            select: { universalVoucherId: true, totalAmount: true, creditPeriodDays: true },
        }),
        sumLinked(db, ids),
        opts.excludeId === undefined
            ? Promise.resolve({} as Record<number, number>)
            : pairAmounts(db, opts.excludeId, ids),
    ]);

    const detailBySpine = new Map(details.map((d) => [d.universalVoucherId, d]));

    const docs: LinkableDoc[] = [];
    for (const s of spines) {
        const signed = legs.get(s.id) ?? 0;
        const side = sideOf(signed);
        if (side === 0) continue;
        if (opts.side !== undefined && side !== opts.side) continue;

        const open = round2(Math.abs(signed) - (linked[s.id] ?? 0));
        if (open <= EPS) continue;

        const detail = detailBySpine.get(s.id);

        docs.push({
            universalVoucherId: s.id,
            voucherType:        s.type,
            ref:                s.voucherNo ?? formatUvNo(s.id),
            date:               s.date.toISOString(),
            dueDate:            dueDateOf(s.date, detail?.creditPeriodDays).toISOString(),
            side,
            face:               detail?.totalAmount != null ? Number(detail.totalAmount) : Math.abs(signed),
            linked:             linked[s.id] ?? 0,
            open,
            ...(opts.excludeId === undefined ? {} : { linkedHere: here[s.id] ?? 0 }),
        });
    }

    // Oldest first — a plain, stable reading order for the list. Auto does NOT
    // use it: it walks `autoLinkOrder` (due date, then the smaller bill), which
    // is a different question from how the bills are shown.
    docs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.universalVoucherId - b.universalVoucherId));
    return docs;
}

/**
 * How much of each `otherIds` bill is already settled by `voucherId` — the
 * amount on the one allocation row the pair shares, in either orientation.
 *
 * The link save states what the pair's total SHOULD be rather than what to add
 * to it, so the client has to know what it currently is. Without this, a user
 * reopening the popup would be offered the same money to place a second time.
 */
export async function pairAmounts(
    db: Prisma.TransactionClient,
    voucherId: number,
    otherIds: number[],
): Promise<Record<number, number>> {
    const ids = otherIds.filter((id) => id !== voucherId);
    if (ids.length === 0) return {};
    const rows = await db.voucherAllocation.findMany({
        where: {
            ...LINK_SHAPE,
            OR: [
                { targetId: voucherId, sourceId: { in: ids } },
                { sourceId: voucherId, targetId: { in: ids } },
            ],
        },
        select: { targetId: true, sourceId: true, amount: true },
    });
    const out: Record<number, number> = {};
    for (const r of rows) {
        const other = r.targetId === voucherId ? r.sourceId : r.targetId;
        out[other] = round2((out[other] ?? 0) + Number(r.amount));
    }
    return out;
}

/**
 * One voucher's own standing against a party — its side and how much of it is
 * still unplaced. This is what the link popup needs about the voucher the user
 * has open: how much money is free to place, and therefore which side of the
 * party's book it may be placed against.
 *
 * Null when the voucher does not touch this party, or has nothing left open.
 */
export async function loadDocOpen(
    db: Prisma.TransactionClient,
    accountId: number,
    spineId: number,
): Promise<LinkableDoc | null> {
    const [legs, spine] = await Promise.all([
        loadPartyLegs(db, accountId, [spineId]),
        db.universalVoucher.findFirst({
            where:  { id: spineId, ...ledgerStatusFilterUv() },
            select: { id: true, type: true, voucherNo: true, date: true },
        }),
    ]);
    if (!spine) return null;

    const signed = legs.get(spineId) ?? 0;
    const side = sideOf(signed);
    if (side === 0) return null;

    const [detail, linked] = await Promise.all([
        db.voucherDetail.findFirst({
            where:  { universalVoucherId: spineId },
            select: { totalAmount: true, creditPeriodDays: true },
        }),
        sumLinked(db, [spineId]),
    ]);

    const open = round2(Math.abs(signed) - (linked[spineId] ?? 0));
    const due = dueDateOf(spine.date, detail?.creditPeriodDays);

    return {
        universalVoucherId: spine.id,
        voucherType:        spine.type,
        ref:                spine.voucherNo ?? formatUvNo(spine.id),
        date:               spine.date.toISOString(),
        dueDate:            due.toISOString(),
        side,
        face:               detail?.totalAmount != null ? Number(detail.totalAmount) : Math.abs(signed),
        linked:             linked[spineId] ?? 0,
        open,
    };
}

export type LinkOrientation = {
    /** The receivable side (+1) — kept as the target so every existing reader stays right. */
    targetId: number;
    /** The payable side (−1). */
    sourceId: number;
};

/**
 * Every rule a link must satisfy, checked in one place so the API and the inline
 * voucher path cannot drift apart. Throws `BillLinkError` with a sentence meant
 * for the user; returns which voucher goes on which side.
 *
 * Orientation matters: the receivable side is ALWAYS stored as `targetId`. That
 * keeps the historical target-side rows meaning what they always meant, and it
 * turns "this pair is already linked" into a plain ordered lookup instead of an
 * unordered-pair search.
 */
export async function assertLinkable(
    tx: Prisma.TransactionClient,
    args: {
        accountId: number; aId: number; bId: number; amount: number;
        /** What this pair is already linked for, when the write REPLACES that
         *  figure rather than adding to it. Both ends already count it as spent,
         *  so it has to be given back before measuring the room. */
        replacing?: number;
    },
): Promise<LinkOrientation> {
    const amount = round2(args.amount);
    if (amount <= EPS) throw new BillLinkError("Link amount must be more than zero.");
    if (args.aId === args.bId) throw new BillLinkError("A voucher cannot settle itself.");

    const parties = await partyLedgerIds();
    if (!parties.has(args.accountId)) {
        throw new BillLinkError(
            "Bills can only be linked on a party ledger (under Sundry Debtors or Sundry Creditors).",
        );
    }

    const alive = await tx.universalVoucher.findMany({
        where:  { id: { in: [args.aId, args.bId] }, ...ledgerStatusFilterUv() },
        select: { id: true, voucherNo: true },
    });
    if (alive.length !== 2) {
        throw new BillLinkError("Both vouchers must be posted, and neither cancelled nor deleted.");
    }
    const refById = new Map(alive.map((v) => [v.id, v.voucherNo ?? formatUvNo(v.id)]));

    const legs = await loadPartyLegs(tx, args.accountId, [args.aId, args.bId]);
    const aSigned = legs.get(args.aId) ?? 0;
    const bSigned = legs.get(args.bId) ?? 0;
    const aSide = sideOf(aSigned);
    const bSide = sideOf(bSigned);

    if (aSide === 0 || bSide === 0) {
        const which = aSide === 0 ? refById.get(args.aId) : refById.get(args.bId);
        throw new BillLinkError(`${which} has nothing against this party, so there is nothing to link.`);
    }
    if (aSide === bSide) {
        throw new BillLinkError(
            aSide === 1
                ? "Both vouchers are amounts the party owes us. One of them has to be a payment side (receipt, credit note, purchase or journal)."
                : "Both vouchers are amounts we owe the party. One of them has to be a receivable side (sale, debit note or journal).",
        );
    }

    const linked = await sumLinked(tx, [args.aId, args.bId]);
    const replacing = round2(args.replacing ?? 0);
    const aOpen = round2(Math.abs(aSigned) - (linked[args.aId] ?? 0) + replacing);
    const bOpen = round2(Math.abs(bSigned) - (linked[args.bId] ?? 0) + replacing);
    // Both sides are checked: a link overdrawing either end would mis-state the
    // books just as badly, whichever end it is.
    if (amount > aOpen + 0.01) {
        throw new BillLinkError(`${refById.get(args.aId)} has only ₹${aOpen.toFixed(2)} open — cannot link ₹${amount.toFixed(2)}.`);
    }
    if (amount > bOpen + 0.01) {
        throw new BillLinkError(`${refById.get(args.bId)} has only ₹${bOpen.toFixed(2)} open — cannot link ₹${amount.toFixed(2)}.`);
    }

    return aSide === 1
        ? { targetId: args.aId, sourceId: args.bId }
        : { targetId: args.bId, sourceId: args.aId };
}

/**
 * Refuse an edit that would strand a settlement. Call INSIDE the edit's own
 * transaction, once the new lines are written — it reads the voucher as it now
 * stands, so a refusal rolls the whole edit back.
 *
 * Two ways an in-place edit used to break the books silently, both because the
 * line rewrite knew nothing about links:
 *
 *   • Reduce a fully-linked ₹10,000 receipt to ₹3,000 and its open goes to
 *     −₹7,000. `loadLinkableDocs` drops anything not positive, so the receipt
 *     vanishes from the list — while the bill it settled still counts the whole
 *     ₹10,000 as paid and drops out of Receivables too. Money simply disappears
 *     from the reports.
 *   • Move a linked voucher onto a different party and the link survives,
 *     netting against a party who never had it.
 *
 * The rule is the one `saveOpeningBills` already applies to an opening bill: an
 * amount may not fall below what has been settled against it. Unlink first.
 */
export async function assertLinksSurviveEdit(
    tx: Prisma.TransactionClient,
    args: { spineId: number; partyBefore: number | null; partyAfter: number | null },
): Promise<void> {
    const linked = (await sumLinked(tx, [args.spineId]))[args.spineId] ?? 0;
    if (linked <= EPS) return;

    const spine = await tx.universalVoucher.findUnique({
        where:  { id: args.spineId },
        select: { voucherNo: true },
    });
    const ref = spine?.voucherNo ?? formatUvNo(args.spineId);

    if (args.partyAfter == null || args.partyBefore !== args.partyAfter) {
        throw new BillLinkError(
            `${ref} has ₹${linked.toFixed(2)} settled against bills, so its party cannot be changed — unlink it first, then edit.`,
        );
    }

    const legs = await loadPartyLegs(tx, args.partyAfter, [args.spineId]);
    const worth = round2(Math.abs(legs.get(args.spineId) ?? 0));
    if (worth + 0.01 < linked) {
        throw new BillLinkError(
            `${ref} already has ₹${linked.toFixed(2)} settled against bills, so it cannot be reduced to ₹${worth.toFixed(2)} — unlink it first.`,
        );
    }
}

/** One validated line of a link plan, ready to write. */
export type PlannedLink = LinkOrientation & {
    /** The counterpart bill, as the caller named it. */
    voucherId: number;
    amount:    number;
    /** What the pair is linked for today — 0 unless the write replaces it. */
    replacing: number;
};

/**
 * The same rules as `assertLinkable`, for a whole plan at once.
 *
 * Checking link-by-link meant `partyLedgerIds()` (two uncached group-tree walks),
 * a `loadPartyLegs` and a `sumLinked` per line — around 1,400 queries for a
 * 200-line plan, all inside one transaction, which is a long time to hold a lock
 * a till may be waiting on. Everything is read once here and the room is tracked
 * in memory, so the money still cannot be spent twice: each line is measured
 * against what the earlier lines already took.
 */
export async function assertLinkPlan(
    tx: Prisma.TransactionClient,
    args: {
        accountId: number;
        voucherId: number;
        links: { voucherId: number; amount: number }[];
        /** `set` = each amount is what that pair should TOTAL, not what to add. */
        mode:  "increment" | "set";
    },
): Promise<PlannedLink[]> {
    const parties = await partyLedgerIds();
    if (!parties.has(args.accountId)) {
        throw new BillLinkError(
            "Bills can only be linked on a party ledger (under Sundry Debtors or Sundry Creditors).",
        );
    }
    if (args.links.some((l) => l.voucherId === args.voucherId)) {
        throw new BillLinkError("A voucher cannot settle itself.");
    }
    const otherIds = args.links.map((l) => l.voucherId);
    if (new Set(otherIds).size !== otherIds.length) {
        throw new BillLinkError("The same bill is listed twice — each bill takes one line.");
    }

    const allIds = [args.voucherId, ...otherIds];
    const alive = await tx.universalVoucher.findMany({
        where:  { id: { in: allIds }, ...ledgerStatusFilterUv() },
        select: { id: true, voucherNo: true },
    });
    if (alive.length !== allIds.length) {
        throw new BillLinkError("Every voucher must be posted, and neither cancelled nor deleted.");
    }
    const refById = new Map(alive.map((v) => [v.id, v.voucherNo ?? formatUvNo(v.id)]));

    const [legs, linked, pairs] = await Promise.all([
        loadPartyLegs(tx, args.accountId, allIds),
        sumLinked(tx, allIds),
        args.mode === "set"
            ? pairAmounts(tx, args.voucherId, otherIds)
            : Promise.resolve({} as Record<number, number>),
    ]);

    const selfSigned = legs.get(args.voucherId) ?? 0;
    const selfSide = sideOf(selfSigned);
    if (selfSide === 0) {
        throw new BillLinkError(
            `${refById.get(args.voucherId)} has nothing against this party, so there is nothing to link.`,
        );
    }

    const out: PlannedLink[] = [];
    let selfReplacing = 0;
    let selfPlaced = 0;

    for (const l of args.links) {
        const amount = round2(l.amount);
        if (amount <= EPS) throw new BillLinkError("Link amount must be more than zero.");

        const signed = legs.get(l.voucherId) ?? 0;
        const side = sideOf(signed);
        if (side === 0) {
            throw new BillLinkError(`${refById.get(l.voucherId)} has nothing against this party, so there is nothing to link.`);
        }
        if (side === selfSide) {
            throw new BillLinkError(
                selfSide === 1
                    ? "Both vouchers are amounts the party owes us. One of them has to be a payment side (receipt, credit note, purchase or journal)."
                    : "Both vouchers are amounts we owe the party. One of them has to be a receivable side (sale, debit note or journal).",
            );
        }

        const replacing = round2(pairs[l.voucherId] ?? 0);
        const room = round2(Math.abs(signed) - (linked[l.voucherId] ?? 0) + replacing);
        if (amount > room + 0.01) {
            throw new BillLinkError(
                `${refById.get(l.voucherId)} has only ₹${room.toFixed(2)} open — cannot link ₹${amount.toFixed(2)}.`,
            );
        }

        selfReplacing = round2(selfReplacing + replacing);
        selfPlaced = round2(selfPlaced + amount);
        out.push({
            voucherId: l.voucherId,
            amount,
            replacing,
            ...(selfSide === 1
                ? { targetId: args.voucherId, sourceId: l.voucherId }
                : { targetId: l.voucherId, sourceId: args.voucherId }),
        });
    }

    // The linking voucher is checked once, against everything the plan places on
    // it — the per-line loop it replaced only ever saw one line at a time.
    const selfRoom = round2(Math.abs(selfSigned) - (linked[args.voucherId] ?? 0) + selfReplacing);
    if (selfPlaced > selfRoom + 0.01) {
        throw new BillLinkError(
            `${refById.get(args.voucherId)} has only ₹${selfRoom.toFixed(2)} open — cannot place ₹${selfPlaced.toFixed(2)}.`,
        );
    }
    return out;
}

/**
 * Write one link, in one of two ways:
 *
 *   • `increment` (the default) — adds to whatever the pair already has. Right
 *     for every caller that links a voucher it created moments ago in the same
 *     transaction, where the pair cannot already exist.
 *   • `set` — the pair ends up at exactly this amount. Right for a screen that
 *     knows the whole answer, because then SAVING TWICE CHANGES NOTHING: a lost
 *     response, a double click or a replayed request all land on the same
 *     figure. `assertLinkable` must be given `replacing` so it measures the room
 *     with the old figure handed back.
 *
 * Deliberately a `findFirst` + update rather than an upsert on the unique key:
 * that key includes `sourceType`, so a legacy `PAYMENT`-sourced row for the same
 * pair would be invisible to the upsert and a SECOND row would appear. Both
 * would then be counted, the bill would net to zero and drop out of the reports.
 */
export async function createLink(
    tx: Prisma.TransactionClient,
    args: {
        targetId: number; sourceId: number; amount: number;
        reference?: string | null; userId: number;
        mode?: "increment" | "set";
    },
): Promise<number> {
    const amount = round2(args.amount);
    const existing = await tx.voucherAllocation.findFirst({
        where:  { ...LINK_SHAPE, targetId: args.targetId, sourceId: args.sourceId },
        select: { id: true },
    });
    if (existing) {
        await tx.voucherAllocation.update({
            where: { id: existing.id },
            data:  {
                amount: args.mode === "set" ? amount : { increment: amount },
                ...(args.reference ? { reference: args.reference } : {}),
            },
        });
        return existing.id;
    }
    const created = await tx.voucherAllocation.create({
        data: {
            targetType:  "UNIVERSAL_VOUCHER",
            targetId:    args.targetId,
            sourceType:  "VOUCHER",
            sourceId:    args.sourceId,
            amount,
            method:      "AGAINST_REF",
            reference:   args.reference ?? null,
            createdById: args.userId,
        },
        select: { id: true },
    });
    return created.id;
}

/** Unlink one link. The vouchers stay; only the "which bill" statement goes. */
export async function removeLink(
    tx: Prisma.TransactionClient,
    id: number,
): Promise<{ targetId: number; sourceId: number; amount: number } | null> {
    const row = await tx.voucherAllocation.findUnique({
        where:  { id },
        select: { id: true, targetId: true, sourceId: true, amount: true },
    });
    if (!row) return null;
    await tx.voucherAllocation.delete({ where: { id } });
    return { targetId: row.targetId, sourceId: row.sourceId, amount: Number(row.amount) };
}

/**
 * Drop every link this voucher takes part in — called when it is cancelled or
 * deleted, so nothing dangles. Returns what was removed, for the AuditLog
 * snapshot.
 *
 * Correctness does NOT depend on this running: `sumLinked` already ignores a link
 * whose other end died, so the counterpart reopens the moment the voucher does.
 * This is housekeeping, and it is what makes the removal show up in the audit
 * trail rather than only in a report.
 */
export async function removeLinksForVoucher(
    tx: Prisma.TransactionClient,
    spineId: number,
): Promise<{ id: number; targetId: number; sourceId: number; amount: number }[]> {
    const rows = await tx.voucherAllocation.findMany({
        where:  { ...LINK_SHAPE, OR: [{ targetId: spineId }, { sourceId: spineId }] },
        select: { id: true, targetId: true, sourceId: true, amount: true },
    });
    if (rows.length === 0) return [];
    await tx.voucherAllocation.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return rows.map((r) => ({ id: r.id, targetId: r.targetId, sourceId: r.sourceId, amount: Number(r.amount) }));
}
