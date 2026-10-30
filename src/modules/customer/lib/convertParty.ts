// Person ↔ Company conversion and duplicate merge — single source of truth for
// the data move.
//
// Both work like moving a ledger from one group to another: the history is on
// the Account, not on the party row. A CONVERSION keeps the Account and only
// flips Account.personId ↔ Account.companyId, so every FK pointing at it —
// UniversalVoucher.partyAccountId, VoucherGlLine, Ticket.accountId,
// Device.accountId — survives untouched. A MERGE re-points every one of those
// from the loser's Account onto the winner's and drops the loser's Account.
//
// Then, in both, everything that names the party ROW by id — contacts, deals,
// help tickets, CRM notes, and the bills' stored party reference
// (VoucherDetail.partyType/partyId) — is re-pointed at the surviving row
// (`movePartyRefs`), and the old row is DELETED in the same transaction.
// Nothing is left behind: no tombstone, no forwarding note, no Trash.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { resetReconciliation } from "@/modules/accountancy/lib/reconciliation";

type Db = Prisma.TransactionClient | typeof prisma;
type PartyKind = "person" | "company";
type PartyAt = { kind: PartyKind; id: number };

/** How a bill's `partyType` names each table — see `partyKindFromType`. */
const PARTY_TYPE: Record<PartyKind, "customer" | "company"> = { person: "customer", company: "company" };

/** Everything that names a party row by id, counted the same way before (preview) and after (result). */
export type PartyRefCounts = {
    phones: number;
    emails: number;
    deals: number;
    helpTickets: number;
    /** CRM Reconnect notes / calls logged on the party (TicketLog). */
    timelineLogs: number;
    /** Bills whose stored party reference is re-pointed at the surviving row. */
    vouchers: number;
    personCompanyLinks: number;
    /** Person only: shop orders naming the person. */
    shopOrders: number;
    /** Person only: the customer's portal login. */
    portalCredential: number;
    /** Person only: the customer's social profile (and friend links) go with the row. */
    socialProfile: number;
};

const ZERO_COUNTS: PartyRefCounts = {
    phones: 0, emails: 0, deals: 0, helpTickets: 0, timelineLogs: 0, vouchers: 0,
    personCompanyLinks: 0, shopOrders: 0, portalCredential: 0, socialProfile: 0,
};

async function countPartyRefs(db: Db, at: PartyAt): Promise<PartyRefCounts> {
    const by = at.kind === "person" ? { personId: at.id } : { companyId: at.id };
    // One after another, not Promise.all: `db` is a transaction in the merge and
    // convert paths, and pg 9 refuses two queries on one connection at once.
    const phones = await db.phone.count({ where: by });
    const emails = await db.email.count({ where: by });
    const deals = await db.ticketDeal.count({ where: by });
    const helpTickets = await db.ticketHelp.count({ where: by });
    const timelineLogs = await db.ticketLog.count({ where: by });
    const vouchers = await db.voucherDetail.count({ where: { partyType: PARTY_TYPE[at.kind], partyId: at.id } });
    const links = await db.personCompany.count({ where: by });
    const counts = { ...ZERO_COUNTS, phones, emails, deals, helpTickets, timelineLogs, vouchers, personCompanyLinks: links };
    if (at.kind === "person") {
        const shopOrders = await db.ticketOrder.count({ where: { personId: at.id } });
        const portalCredential = await db.personPortalCredential.count({ where: { personId: at.id } });
        const socialProfile = await db.customerSocialProfile.count({ where: { personId: at.id } });
        Object.assign(counts, { shopOrders, portalCredential, socialProfile });
    }
    return counts;
}

/**
 * Re-point everything that names `from` by id at `to`: deals, help tickets, CRM
 * notes and the bills' stored party reference. Phones, emails and the
 * "contact at company" links are handled by each caller — a merge has primary
 * flags and duplicates to settle, a conversion drops the links.
 *
 * A bill's printed name and address are frozen in `partyJson`, so the pointer
 * can follow the party without rewriting what the document says.
 *
 * The three ticket tables ride their parent Ticket's `updatedAt` to the
 * counters (`strategy: child`), so the parents are touched too — otherwise a
 * till would show the moved ticket under a party it no longer has until the
 * hourly reconcile. Bills carry their own watermark.
 */
async function movePartyRefs(tx: Prisma.TransactionClient, from: PartyAt, to: PartyAt): Promise<void> {
    const fromBy = from.kind === "person" ? { personId: from.id } : { companyId: from.id };
    const toData = to.kind === "person"
        ? { personId: to.id, companyId: null }
        : { personId: null, companyId: to.id };

    // Sequential — one transaction is one connection (see countPartyRefs).
    const deals = await tx.ticketDeal.findMany({ where: fromBy, select: { ticketId: true } });
    const helps = await tx.ticketHelp.findMany({ where: fromBy, select: { ticketId: true } });
    await tx.ticketDeal.updateMany({ where: fromBy, data: toData });
    await tx.ticketHelp.updateMany({ where: fromBy, data: toData });
    await tx.ticketLog.updateMany({ where: fromBy, data: toData });
    await tx.voucherDetail.updateMany({
        where: { partyType: PARTY_TYPE[from.kind], partyId: from.id },
        data:  { partyType: PARTY_TYPE[to.kind],   partyId: to.id },
    });

    const ticketIds = [...deals, ...helps].map((t) => t.ticketId);
    if (ticketIds.length > 0) {
        await tx.ticket.updateMany({ where: { id: { in: ticketIds } }, data: { updatedAt: new Date() } });
    }
}

// ── Convert: preview ─────────────────────────────────────────────────────────

export type ConvertDirection = "personToCompany" | "companyToPerson";

export type ConvertOverrides = {
    // Company-only fields the caller can seed when going Person → Company.
    companyReg?: string | null;
    taxId?: string | null;
    financialYearFrom?: Date | null;
    booksBeginningFrom?: Date | null;
};

export type ConvertBlocker =
    | { kind: "notFound" }
    | { kind: "alreadyInactive" }
    | { kind: "noAccount" }
    | { kind: "openShopOrders"; count: number };

export type ConvertPreview = {
    direction: ConvertDirection;
    sourceId: number;
    sourceName: string;
    accountId: number | null;
    mappableFields: string[];
    lostFields: string[];
    counts: PartyRefCounts;
    blockers: ConvertBlocker[];
};

export type ConvertResult = {
    newId: number;
    newType: PartyKind;
    accountId: number | null;
    sourceId: number;
    sourceType: PartyKind;
    counts: PartyRefCounts;
};

const TERMINAL_SHOP_STATUSES = ["DELIVERED", "REFUNDED", "CANCELLED"] as const;

const MAPPABLE_FIELDS = [
    "name", "address", "gstin", "gstStateCode", "gstRegType", "shippingStateCode",
];
const PERSON_ONLY_FIELDS = ["agreedToTerms", "agreedAt"];
const COMPANY_ONLY_FIELDS = [
    "companyReg", "taxId", "financialYearFrom", "booksBeginningFrom",
];

export async function previewConvert(
    direction: ConvertDirection,
    sourceId: number,
): Promise<ConvertPreview> {
    if (direction === "personToCompany") {
        const p = await prisma.person.findUnique({
            where: { id: sourceId },
            select: {
                name: true, isActive: true,
                account: { select: { id: true } },
                orderTickets: { select: { legacyStatus: true } },
            },
        });
        if (!p) {
            return emptyPreview(direction, sourceId, "Unknown person", [{ kind: "notFound" }]);
        }
        const blockers: ConvertBlocker[] = [];
        if (!p.isActive) blockers.push({ kind: "alreadyInactive" });
        if (!p.account) blockers.push({ kind: "noAccount" });
        const openOrders = p.orderTickets.filter(
            o => !(TERMINAL_SHOP_STATUSES as readonly string[]).includes(o.legacyStatus),
        );
        if (openOrders.length > 0) {
            blockers.push({ kind: "openShopOrders", count: openOrders.length });
        }
        return {
            direction,
            sourceId,
            sourceName: p.name,
            accountId: p.account?.id ?? null,
            mappableFields: MAPPABLE_FIELDS,
            lostFields: PERSON_ONLY_FIELDS,
            counts: await countPartyRefs(prisma, { kind: "person", id: sourceId }),
            blockers,
        };
    }

    // Company → Person
    const c = await prisma.company.findUnique({
        where: { id: sourceId },
        select: { name: true, isActive: true, account: { select: { id: true } } },
    });
    if (!c) {
        return emptyPreview(direction, sourceId, "Unknown company", [{ kind: "notFound" }]);
    }
    const blockers: ConvertBlocker[] = [];
    if (!c.isActive) blockers.push({ kind: "alreadyInactive" });
    if (!c.account) blockers.push({ kind: "noAccount" });
    return {
        direction,
        sourceId,
        sourceName: c.name,
        accountId: c.account?.id ?? null,
        mappableFields: MAPPABLE_FIELDS,
        lostFields: COMPANY_ONLY_FIELDS,
        counts: await countPartyRefs(prisma, { kind: "company", id: sourceId }),
        blockers,
    };
}

function emptyPreview(
    direction: ConvertDirection,
    sourceId: number,
    name: string,
    blockers: ConvertBlocker[],
): ConvertPreview {
    return {
        direction, sourceId, sourceName: name, accountId: null,
        mappableFields: [], lostFields: [],
        counts: ZERO_COUNTS,
        blockers,
    };
}

// ── Convert ──────────────────────────────────────────────────────────────────

export class ConvertBlockedError extends Error {
    status = 409;
    constructor(public blockers: ConvertBlocker[]) {
        super(`Conversion blocked: ${blockers.map(b => b.kind).join(", ")}`);
    }
}

export async function convertParty(
    direction: ConvertDirection,
    sourceId: number,
    overrides: ConvertOverrides = {},
): Promise<ConvertResult> {
    const preview = await previewConvert(direction, sourceId);
    if (preview.blockers.length > 0) {
        throw new ConvertBlockedError(preview.blockers);
    }
    if (direction === "personToCompany") {
        return personToCompany(sourceId, overrides);
    }
    return companyToPerson(sourceId);
}

async function personToCompany(
    sourceId: number,
    overrides: ConvertOverrides,
): Promise<ConvertResult> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const source = await tx.person.findUniqueOrThrow({
            where: { id: sourceId },
            include: { account: true },
        });
        const from: PartyAt = { kind: "person", id: sourceId };
        const counts = await countPartyRefs(tx, from);

        const newCompany = await tx.company.create({
            data: {
                name: source.name,
                address: source.address,
                gstin: source.gstin,
                gstStateCode: source.gstStateCode,
                gstRegType: source.gstRegType,
                shippingStateCode: source.shippingStateCode,
                companyReg: overrides.companyReg ?? null,
                taxId: overrides.taxId ?? null,
                financialYearFrom: overrides.financialYearFrom ?? null,
                booksBeginningFrom: overrides.booksBeginningFrom ?? null,
            },
        });
        const to: PartyAt = { kind: "company", id: newCompany.id };

        // Flip the Account ownership atomically. The @unique on personId allows
        // multiple nulls, so the constraint never sees two rows holding the
        // same personId — this row simply trades sides in one UPDATE.
        if (source.account) {
            await tx.account.update({
                where: { id: source.account.id },
                data: {
                    personId: null,
                    companyId: newCompany.id,
                    name: newCompany.name,
                },
            });
        }

        const toCompany = { personId: null, companyId: newCompany.id };
        await tx.phone.updateMany({ where: { personId: sourceId }, data: toCompany });
        await tx.email.updateMany({ where: { personId: sourceId }, data: toCompany });
        await movePartyRefs(tx, from, to);

        // PersonCompany links describe "this person is a contact at company X".
        // After the person becomes a company, those links are meaningless.
        await tx.personCompany.deleteMany({ where: { personId: sourceId } });

        // Order tickets: only terminal orders survive a Person→Company conversion
        // (the preview enforces this). For those, drop the personId pointer;
        // accountId already points at the moved Account, which carries the AR.
        await tx.ticketOrder.updateMany({
            where: { personId: sourceId },
            data: { personId: null },
        });

        // Gone with the row (ON DELETE CASCADE): the portal credential, the
        // social profile and friend links — a company has none of these.
        await tx.person.delete({ where: { id: sourceId } });

        return {
            newId: newCompany.id,
            newType: "company" as const,
            accountId: source.account?.id ?? null,
            sourceId,
            sourceType: "person" as const,
            counts,
        };
    });
}

async function companyToPerson(sourceId: number): Promise<ConvertResult> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const source = await tx.company.findUniqueOrThrow({
            where: { id: sourceId },
            include: { account: true },
        });
        const from: PartyAt = { kind: "company", id: sourceId };
        const counts = await countPartyRefs(tx, from);

        const newPerson = await tx.person.create({
            data: {
                name: source.name,
                address: source.address,
                gstin: source.gstin,
                gstStateCode: source.gstStateCode,
                gstRegType: source.gstRegType,
                shippingStateCode: source.shippingStateCode,
            },
        });
        const to: PartyAt = { kind: "person", id: newPerson.id };

        if (source.account) {
            await tx.account.update({
                where: { id: source.account.id },
                data: {
                    companyId: null,
                    personId: newPerson.id,
                    name: newPerson.name,
                },
            });
        }

        const toPerson = { companyId: null, personId: newPerson.id };
        await tx.phone.updateMany({ where: { companyId: sourceId }, data: toPerson });
        await tx.email.updateMany({ where: { companyId: sourceId }, data: toPerson });
        await movePartyRefs(tx, from, to);

        // PersonCompany links on the source company described other persons
        // being contacts at this company. Company is gone, so they're dropped.
        await tx.personCompany.deleteMany({ where: { companyId: sourceId } });

        await tx.company.delete({ where: { id: sourceId } });

        return {
            newId: newPerson.id,
            newType: "person" as const,
            accountId: source.account?.id ?? null,
            sourceId,
            sourceType: "company" as const,
            counts,
        };
    });
}

// ── Merge two duplicate same-type customers ──────────────────────────────────
//
// Loser's Account is dissolved: every UniversalVoucher.partyAccountId /
// VoucherGlLine.accountId / settlement tender+charge / Ticket.accountId /
// Device.accountId is re-pointed at the winner's Account and the balances are
// summed, then the loser Account row is deleted. Everything naming the loser
// row moves to the winner (`movePartyRefs` + contacts + links), and the loser
// row is deleted.

export type MergeKind = PartyKind;

export type MergeBlocker =
    | { kind: "notFound"; side: "winner" | "loser" }
    | { kind: "sameId" }
    | { kind: "sourceInactive"; side: "winner" | "loser" }
    | { kind: "noAccount"; side: "winner" | "loser" }
    | { kind: "accountIsTillOrVault"; usage: string }
    | { kind: "accountIsParent"; childCount: number };

/** Account FK references that will be re-pointed onto the winner's Account. */
export type MergeAccountRefs = {
    voucherParty: number;
    voucherGlLines: number;
    invVoucherCharges: number;
    invVoucherTenders: number;
    tickets: number;
    devices: number;
};

export type MergePreview = {
    kind: MergeKind;
    winnerId: number;
    loserId: number;
    winnerName: string;
    loserName: string;
    winnerAccountId: number | null;
    loserAccountId: number | null;
    accountRefs: MergeAccountRefs;
    /** Everything naming the loser row that moves to the winner (or, for person-only rows, is dropped). */
    partyRefs: PartyRefCounts;
    blockers: MergeBlocker[];
};

export type MergeResult = {
    kind: MergeKind;
    winnerId: number;
    winnerAccountId: number;
    loserId: number;
    loserAccountId: number;
    movedCounts: MergeAccountRefs & PartyRefCounts;
};

export class MergeBlockedError extends Error {
    status = 409;
    constructor(public blockers: MergeBlocker[]) {
        super(`Merge blocked: ${blockers.map(b => b.kind).join(", ")}`);
    }
}

async function partyAccountUsage(accountId: number): Promise<MergeBlocker[]> {
    const blockers: MergeBlocker[] = [];
    const [vaultUse, tillUse, payAcctUse, children] = await Promise.all([
        prisma.branch.count({ where: { vaultAccountId: accountId } }),
        prisma.posCounter.count({ where: { tillAccountId: accountId } }),
        prisma.posCounterPaymentAccount.count({ where: { accountId } }),
        prisma.account.count({ where: { parentId: accountId } }),
    ]);
    const tags: string[] = [];
    if (vaultUse) tags.push(`Branch.vaultAccountId×${vaultUse}`);
    if (tillUse) tags.push(`PosCounter.tillAccountId×${tillUse}`);
    if (payAcctUse) tags.push(`PosCounterPaymentAccount.accountId×${payAcctUse}`);
    if (tags.length > 0) blockers.push({ kind: "accountIsTillOrVault", usage: tags.join(", ") });
    if (children > 0) blockers.push({ kind: "accountIsParent", childCount: children });
    return blockers;
}

async function loadForMerge(at: PartyAt) {
    const select = { id: true, name: true, isActive: true, account: { select: { id: true } } } as const;
    return at.kind === "person"
        ? prisma.person.findUnique({ where: { id: at.id }, select })
        : prisma.company.findUnique({ where: { id: at.id }, select });
}

export async function previewMerge(
    kind: MergeKind,
    winnerId: number,
    loserId: number,
): Promise<MergePreview> {
    const blockers: MergeBlocker[] = [];
    if (winnerId === loserId) blockers.push({ kind: "sameId" });

    const [winner, loser] = await Promise.all([
        loadForMerge({ kind, id: winnerId }),
        loadForMerge({ kind, id: loserId }),
    ]);
    if (!winner) blockers.push({ kind: "notFound", side: "winner" });
    if (!loser) blockers.push({ kind: "notFound", side: "loser" });

    const winnerName = winner?.name ?? "—";
    const loserName = loser?.name ?? "—";
    const winnerAccountId = winner?.account?.id ?? null;
    const loserAccountId = loser?.account?.id ?? null;

    if (winner && !winner.isActive) blockers.push({ kind: "sourceInactive", side: "winner" });
    if (loser && !loser.isActive) blockers.push({ kind: "sourceInactive", side: "loser" });
    if (winner && !winnerAccountId) blockers.push({ kind: "noAccount", side: "winner" });
    if (loser && !loserAccountId) blockers.push({ kind: "noAccount", side: "loser" });

    if (loserAccountId) {
        blockers.push(...(await partyAccountUsage(loserAccountId)));
    }

    const [partyRefs, accountRefs] = await Promise.all([
        countPartyRefs(prisma, { kind, id: loserId }),
        loserAccountId ? countAccountRefs(loserAccountId) : Promise.resolve<MergeAccountRefs>({
            voucherParty: 0, voucherGlLines: 0, invVoucherCharges: 0, invVoucherTenders: 0, tickets: 0, devices: 0,
        }),
    ]);

    return {
        kind, winnerId, loserId, winnerName, loserName, winnerAccountId, loserAccountId,
        accountRefs, partyRefs, blockers,
    };
}

async function countAccountRefs(accountId: number): Promise<MergeAccountRefs> {
    const [voucherParty, voucherGlLines, tickets, devices, settlementRows] = await Promise.all([
        // Party + GL lines live on the UniversalVoucher spine.
        prisma.universalVoucher.count({ where: { partyAccountId: accountId } }),
        prisma.voucherGlLine.count({ where: { accountId } }),
        // Every flavour (repair + order + …) shares Ticket.accountId.
        prisma.ticket.count({ where: { accountId } }),
        prisma.device.count({ where: { accountId } }),
        // Tender/charge input lives in settlementJson — scan for refs.
        prisma.voucherDetail.findMany({ where: { settlementJson: { not: Prisma.DbNull } }, select: { settlementJson: true } }),
    ]);
    let invVoucherCharges = 0, invVoucherTenders = 0;
    for (const r of settlementRows) {
        const s = readSettlement(r.settlementJson);
        invVoucherCharges += s.charges.filter((c) => c.accountId === accountId).length;
        invVoucherTenders += s.tenders.filter((t) => t.accountId === accountId).length;
    }
    return { voucherParty, voucherGlLines, invVoucherCharges, invVoucherTenders, tickets, devices };
}

export async function mergeParty(
    kind: MergeKind,
    winnerId: number,
    loserId: number,
): Promise<MergeResult> {
    const preview = await previewMerge(kind, winnerId, loserId);
    if (preview.blockers.length > 0) throw new MergeBlockedError(preview.blockers);

    const winnerAccountId = preview.winnerAccountId!;
    const loserAccountId = preview.loserAccountId!;
    const winnerAt: PartyAt = { kind, id: winnerId };
    const loserAt: PartyAt = { kind, id: loserId };

    return prisma.$transaction(async (tx) => {
        const partyCounts = await countPartyRefs(tx, loserAt);

        // 1. Re-point every Account FK from loser's Account → winner's Account.
        //    One after another: a transaction is one connection, and pg 9 refuses
        //    two queries on it at once (Promise.all here warned in pg 8).
        const vp = await tx.universalVoucher.updateMany({ where: { partyAccountId: loserAccountId }, data: { partyAccountId: winnerAccountId } });
        // Covers role=TENDER/CHARGE + body legs pointing at the loser ledger.
        const gll = await tx.voucherGlLine.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } });
        const t = await tx.ticket.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } });
        const d = await tx.device.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } });
        // The winner takes the loser's entries and its opening: every day it has
        // changes, so its reconciliation starts over (see reconciliation.ts).
        await resetReconciliation(tx, [winnerAccountId]);

        // Tender/charge input inside settlementJson (drafts + posted echo).
        const settlementRows = await tx.voucherDetail.findMany({ where: { settlementJson: { not: Prisma.DbNull } }, select: { id: true, settlementJson: true } });
        let ivc = 0, ivt = 0;
        for (const sv of settlementRows) {
            const s = readSettlement(sv.settlementJson);
            const tHit = s.tenders.filter((x) => x.accountId === loserAccountId).length;
            const cHit = s.charges.filter((x) => x.accountId === loserAccountId).length;
            if (tHit + cHit === 0) continue;
            ivt += tHit; ivc += cHit;
            await tx.voucherDetail.update({
                where: { id: sv.id },
                data:  { settlementJson: buildSettlementJson(
                    s.tenders.map((x) => x.accountId === loserAccountId ? { ...x, accountId: winnerAccountId } : x),
                    s.charges.map((x) => x.accountId === loserAccountId ? { ...x, accountId: winnerAccountId } : x),
                    s.promoSnapshot,
                ) },
            });
        }

        // 2. Roll the loser's opening balance into the winner. `openingBalance`
        //    (signed by `openingBalanceType` Dr/Cr) is the master figure
        //    re-posted at books-beginning; merging duplicates must sum it too
        //    or the winner's "started with X" line would silently lose Y.
        const accountSelect = {
            openingBalance: true,
            openingBalanceType: true,
        } as const;
        const winnerAcct = await tx.account.findUniqueOrThrow({ where: { id: winnerAccountId }, select: accountSelect });
        const loserAcct = await tx.account.findUniqueOrThrow({ where: { id: loserAccountId }, select: accountSelect });

        // Opening balance — signed sum using EntryType. DEBIT counts +,
        // CREDIT counts −. Reconstruct the type from the sign of the result.
        const signed = (amount: unknown, type: "DEBIT" | "CREDIT" | null | undefined) => {
            if (amount == null || type == null) return 0;
            const n = Number(amount);
            if (!Number.isFinite(n) || n === 0) return 0;
            return type === "DEBIT" ? n : -n;
        };
        const openSigned = signed(winnerAcct.openingBalance, winnerAcct.openingBalanceType)
            + signed(loserAcct.openingBalance, loserAcct.openingBalanceType);
        const openMag = Math.abs(openSigned);
        const openType: "DEBIT" | "CREDIT" | null = openMag === 0 ? null : openSigned > 0 ? "DEBIT" : "CREDIT";

        await tx.account.update({
            where: { id: winnerAccountId },
            data: {
                openingBalance: openMag === 0 ? null : openMag.toFixed(2),
                openingBalanceType: openType,
                // Universal opening — no date; always from the start of the books.
                openingBalanceDate: null,
            },
        });

        // 3. Move Phone / Email rows from loser onto winner. Global @unique on
        //    `phone` / `email` is satisfied because duplicate parties don't
        //    share contact values (that's how they ended up as two rows).
        //
        //    Primary-tag rule (merge policy):
        //    — WINNER'S primary is preserved unconditionally (your rule).
        //    — If winner had NO phones/emails, loser's primary OR loser's
        //      first row (lowest id) becomes the new primary.
        //    — In no case do we end up with >1 primary post-merge.
        const partyKey = kind === "person" ? "personId" : "companyId";
        const winnerPartyWhere = { [partyKey]: winnerId } as const;

        const winnerHasPhones = await tx.phone.count({ where: winnerPartyWhere });
        const winnerHasEmails = await tx.email.count({ where: winnerPartyWhere });
        const loserPhoneOwnerWhere = { [partyKey]: loserId } as const;

        // When the winner already owns phones/emails, strip the loser's
        // isPrimary flags as we move them — winner's primary stays the sole one.
        const phoneMoveData: Record<string, unknown> =
            kind === "person"
                ? { personId: winnerId, companyId: null, ...(winnerHasPhones > 0 ? { isPrimary: false } : {}) }
                : { companyId: winnerId, personId: null, ...(winnerHasPhones > 0 ? { isPrimary: false } : {}) };
        const emailMoveData: Record<string, unknown> =
            kind === "person"
                ? { personId: winnerId, companyId: null, ...(winnerHasEmails > 0 ? { isPrimary: false } : {}) }
                : { companyId: winnerId, personId: null, ...(winnerHasEmails > 0 ? { isPrimary: false } : {}) };

        await tx.phone.updateMany({ where: loserPhoneOwnerWhere, data: phoneMoveData });
        await tx.email.updateMany({ where: loserPhoneOwnerWhere, data: emailMoveData });
        // The address book moves too; the winner keeps its own primary if it has one.
        if (kind === "person") {
            const winnerHasPrimaryAddress = await tx.personAddress.count({ where: { personId: winnerId, isPrimary: true } });
            await tx.personAddress.updateMany({
                where: { personId: loserId },
                data: { personId: winnerId, ...(winnerHasPrimaryAddress > 0 ? { isPrimary: false } : {}) },
            });
        }

        // 3b. Guarantee at-most-one-primary per contact kind on the winner
        // after the move (fixes the case where loser had multiple primaries
        // from prior buggy merges AND winner previously had zero contacts).
        // Strategy: if any primaries exist, keep the lowest-id one; demote the rest.
        // Branches on `table` explicitly rather than holding `tx.phone | tx.email`
        // in one variable — TS can't call through a union of delegate types.
        async function enforceSinglePrimary(
            table: "phone" | "email",
        ) {
            const primaries = table === "phone"
                ? await tx.phone.findMany({ where: { ...winnerPartyWhere, isPrimary: true }, orderBy: { id: "asc" }, select: { id: true } })
                : await tx.email.findMany({ where: { ...winnerPartyWhere, isPrimary: true }, orderBy: { id: "asc" }, select: { id: true } });
            if (primaries.length <= 1) return;
            const extras = primaries.slice(1).map((r: { id: number }) => r.id);
            if (table === "phone") {
                await tx.phone.updateMany({ where: { id: { in: extras } }, data: { isPrimary: false } });
            } else {
                await tx.email.updateMany({ where: { id: { in: extras } }, data: { isPrimary: false } });
            }
        }

        // 3c. If the winner had no phones/emails but the loser added some,
        // promote the lowest-id new row as primary (canonical first-created rule).
        async function promoteFirstWhenNoPrimary(table: "phone" | "email") {
            const anyPrimary = table === "phone"
                ? await tx.phone.findFirst({ where: { ...winnerPartyWhere, isPrimary: true }, select: { id: true } })
                : await tx.email.findFirst({ where: { ...winnerPartyWhere, isPrimary: true }, select: { id: true } });
            if (anyPrimary) return;
            if (table === "phone") {
                const first = await tx.phone.findFirst({ where: winnerPartyWhere, orderBy: { id: "asc" }, select: { id: true } });
                if (first) await tx.phone.update({ where: { id: first.id }, data: { isPrimary: true } });
            } else {
                const first = await tx.email.findFirst({ where: winnerPartyWhere, orderBy: { id: "asc" }, select: { id: true } });
                if (first) await tx.email.update({ where: { id: first.id }, data: { isPrimary: true } });
            }
        }

        await enforceSinglePrimary("phone");
        await enforceSinglePrimary("email");
        await promoteFirstWhenNoPrimary("phone");
        await promoteFirstWhenNoPrimary("email");

        // 4. PersonCompany links: move loser's onto winner. Dedupe by (personId,
        //    companyId) since the same pair could now appear twice.
        await tx.personCompany.updateMany({
            where: { [partyKey]: loserId },
            data: { [partyKey]: winnerId },
        });
        await dedupePersonCompanyLinks(tx);

        // 5. Deals, help tickets, CRM notes and the bills' stored party reference.
        await movePartyRefs(tx, loserAt, winnerAt);

        // 6. TicketOrder.personId (Person merges only).
        if (kind === "person") {
            await tx.ticketOrder.updateMany({
                where: { personId: loserId },
                data: { personId: winnerId },
            });
        }

        // 7. Drop the loser's Account (now orphaned — every FK was moved).
        await tx.account.delete({ where: { id: loserAccountId } });

        // 8. Delete the loser row. Portal credential, social profile and
        //    friend links go with it (ON DELETE CASCADE) — the winner keeps its own.
        if (kind === "person") {
            await tx.person.delete({ where: { id: loserId } });
        } else {
            await tx.company.delete({ where: { id: loserId } });
        }

        return {
            kind,
            winnerId, winnerAccountId,
            loserId, loserAccountId,
            movedCounts: {
                ...partyCounts,
                voucherParty: vp.count,
                voucherGlLines: gll.count,
                invVoucherCharges: ivc,
                invVoucherTenders: ivt,
                tickets: t.count,
                devices: d.count,
            },
        };
    });
}

async function dedupePersonCompanyLinks(tx: Prisma.TransactionClient) {
    // After a merge, the winner can hold two PersonCompany rows for the same
    // (personId, companyId). Keep the earliest, drop the rest.
    const dupes = await tx.$queryRaw<Array<{ personId: number; companyId: number }>>`
        SELECT "personId", "companyId"
        FROM "PersonCompany"
        GROUP BY "personId", "companyId"
        HAVING COUNT(*) > 1
    `;
    for (const d of dupes) {
        const rows = await tx.personCompany.findMany({
            where: { personId: d.personId, companyId: d.companyId },
            orderBy: { id: "asc" },
            select: { id: true },
        });
        const [, ...extras] = rows;
        if (extras.length > 0) {
            await tx.personCompany.deleteMany({ where: { id: { in: extras.map((r: { id: number }) => r.id) } } });
        }
    }
}
