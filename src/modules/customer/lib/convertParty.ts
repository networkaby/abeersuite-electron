// Person ↔ Company conversion — single source of truth for the data move.
//
// Keeps the Account row intact (just flips Account.personId ↔ Account.companyId)
// so every downstream FK pointing at the Account — InvVoucher.accountId,
// JournalLine.accountId, Ticket.billingAccountId, Device.accountId,
// ShopOrder.accountId, Voucher.partyAccountId — survives unchanged.
//
// The old party row is soft-deleted with a `convertedTo*Id` back-link and
// `isActive=false`, so it appears in the Trash view at
// /office/settings/customer-tools where a hard-delete-permitted admin can
// remove it once they're sure the conversion is correct.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { readSettlement, buildSettlementJson } from "@/shared/lib/accountancy/settlement";

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
    | { kind: "alreadyConverted"; targetId: number }
    | { kind: "noAccount" }
    | { kind: "openShopOrders"; count: number };

export type ConvertPreview = {
    direction: ConvertDirection;
    sourceId: number;
    sourceName: string;
    accountId: number | null;
    mappableFields: string[];
    lostFields: string[];
    counts: {
        phones: number;
        emails: number;
        deals: number;
        personCompanyLinks: number;
        shopOrders: number;
        portalCredential: boolean;
    };
    blockers: ConvertBlocker[];
};

export type ConvertResult = {
    newId: number;
    newType: "person" | "company";
    accountId: number | null;
    sourceId: number;
    sourceType: "person" | "company";
    droppedCounts: {
        phones: number;
        emails: number;
        deals: number;
        personCompanyLinks: number;
        shopOrders: number;
        portalCredential: number;
    };
};

const TERMINAL_SHOP_STATUSES = ["DELIVERED", "REFUNDED", "CANCELLED"] as const;

const MAPPABLE_FIELDS = [
    "name", "address", "gstin", "gstStateCode", "gstRegType", "shippingStateCode",
];
const PERSON_ONLY_FIELDS = ["agreedToTerms", "agreedAt"];
const COMPANY_ONLY_FIELDS = [
    "companyReg", "taxId", "financialYearFrom", "booksBeginningFrom",
];

// ── Preview ──────────────────────────────────────────────────────────────────

export async function previewConvert(
    direction: ConvertDirection,
    sourceId: number,
): Promise<ConvertPreview> {
    if (direction === "personToCompany") {
        const p = await prisma.person.findUnique({
            where: { id: sourceId },
            include: {
                account: { select: { id: true } },
                phones: { select: { id: true } },
                emails: { select: { id: true } },
                companies: { select: { id: true } },
                deals: { select: { id: true } },
                shopOrders: { select: { id: true, status: true } },
                portalCredential: { select: { id: true } },
            },
        });
        if (!p) {
            return emptyPreview(direction, sourceId, "Unknown person", [{ kind: "notFound" }]);
        }
        const blockers: ConvertBlocker[] = [];
        if (!p.isActive) blockers.push({ kind: "alreadyInactive" });
        if (p.convertedToCompanyId != null) {
            blockers.push({ kind: "alreadyConverted", targetId: p.convertedToCompanyId });
        }
        if (!p.account) blockers.push({ kind: "noAccount" });
        const openOrders = p.shopOrders.filter(
            o => !(TERMINAL_SHOP_STATUSES as readonly string[]).includes(o.status),
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
            counts: {
                phones: p.phones.length,
                emails: p.emails.length,
                deals: p.deals.length,
                personCompanyLinks: p.companies.length,
                shopOrders: p.shopOrders.length,
                portalCredential: p.portalCredential != null,
            },
            blockers,
        };
    }

    // Company → Person
    const c = await prisma.company.findUnique({
        where: { id: sourceId },
        include: {
            account: { select: { id: true } },
            phones: { select: { id: true } },
            emails: { select: { id: true } },
            persons: { select: { id: true } },
            deals: { select: { id: true } },
        },
    });
    if (!c) {
        return emptyPreview(direction, sourceId, "Unknown company", [{ kind: "notFound" }]);
    }
    const blockers: ConvertBlocker[] = [];
    if (!c.isActive) blockers.push({ kind: "alreadyInactive" });
    if (c.convertedToPersonId != null) {
        blockers.push({ kind: "alreadyConverted", targetId: c.convertedToPersonId });
    }
    if (!c.account) blockers.push({ kind: "noAccount" });
    return {
        direction,
        sourceId,
        sourceName: c.name,
        accountId: c.account?.id ?? null,
        mappableFields: MAPPABLE_FIELDS,
        lostFields: COMPANY_ONLY_FIELDS,
        counts: {
            phones: c.phones.length,
            emails: c.emails.length,
            deals: c.deals.length,
            personCompanyLinks: c.persons.length,
            shopOrders: 0,
            portalCredential: false,
        },
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
        counts: { phones: 0, emails: 0, deals: 0, personCompanyLinks: 0, shopOrders: 0, portalCredential: false },
        blockers,
    };
}

// ── Conversion ───────────────────────────────────────────────────────────────

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

        const phonesMoved = await tx.phone.updateMany({
            where: { personId: sourceId },
            data: { personId: null, companyId: newCompany.id },
        });
        const emailsMoved = await tx.email.updateMany({
            where: { personId: sourceId },
            data: { personId: null, companyId: newCompany.id },
        });

        // PersonCompany links describe "this person is a contact at company X".
        // After the person becomes a company, those links are meaningless.
        const linksDropped = await tx.personCompany.deleteMany({
            where: { personId: sourceId },
        });

        // Deal already carries both personId and companyId nullable — flip.
        const leadsMoved = await tx.deal.updateMany({
            where: { personId: sourceId },
            data: { personId: null, companyId: newCompany.id },
        });

        // ShopOrder: only terminal orders survive a Person→Company conversion
        // (the preview enforces this). For those, drop the personId pointer;
        // accountId already points at the moved Account, which carries the AR.
        const ordersDetached = await tx.shopOrder.updateMany({
            where: { personId: sourceId },
            data: { personId: null },
        });

        // Companies don't have portal credentials. Delete explicitly because
        // we're soft-deleting the Person (so the cascade FK doesn't fire).
        const credDropped = await tx.personPortalCredential.deleteMany({
            where: { personId: sourceId },
        });

        await tx.person.update({
            where: { id: sourceId },
            data: {
                isActive: false,
                convertedToCompanyId: newCompany.id,
                convertedAt: new Date(),
            },
        });

        return {
            newId: newCompany.id,
            newType: "company" as const,
            accountId: source.account?.id ?? null,
            sourceId,
            sourceType: "person" as const,
            droppedCounts: {
                phones: phonesMoved.count,
                emails: emailsMoved.count,
                deals: leadsMoved.count,
                personCompanyLinks: linksDropped.count,
                shopOrders: ordersDetached.count,
                portalCredential: credDropped.count,
            },
        };
    });
}

async function companyToPerson(sourceId: number): Promise<ConvertResult> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const source = await tx.company.findUniqueOrThrow({
            where: { id: sourceId },
            include: { account: true },
        });

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

        const phonesMoved = await tx.phone.updateMany({
            where: { companyId: sourceId },
            data: { companyId: null, personId: newPerson.id },
        });
        const emailsMoved = await tx.email.updateMany({
            where: { companyId: sourceId },
            data: { companyId: null, personId: newPerson.id },
        });

        // PersonCompany links on the source company described other persons
        // being contacts at this company. Company is gone, so they're dropped.
        const linksDropped = await tx.personCompany.deleteMany({
            where: { companyId: sourceId },
        });

        const leadsMoved = await tx.deal.updateMany({
            where: { companyId: sourceId },
            data: { companyId: null, personId: newPerson.id },
        });

        await tx.company.update({
            where: { id: sourceId },
            data: {
                isActive: false,
                convertedToPersonId: newPerson.id,
                convertedAt: new Date(),
            },
        });

        return {
            newId: newPerson.id,
            newType: "person" as const,
            accountId: source.account?.id ?? null,
            sourceId,
            sourceType: "company" as const,
            droppedCounts: {
                phones: phonesMoved.count,
                emails: emailsMoved.count,
                deals: leadsMoved.count,
                personCompanyLinks: linksDropped.count,
                shopOrders: 0,
                portalCredential: 0,
            },
        };
    });
}

// ── Hard delete (Trash view) ─────────────────────────────────────────────────

export class TombstoneStillReferencedError extends Error {
    status = 409;
    constructor(public references: Array<{ table: string; count: number }>) {
        super(`Tombstone still referenced: ${references.map(r => `${r.table}(${r.count})`).join(", ")}`);
    }
}

export async function hardDeleteTombstone(
    type: "person" | "company",
    id: number,
): Promise<void> {
    if (type === "person") {
        const p = await prisma.person.findUnique({
            where: { id },
            select: { id: true, isActive: true, convertedToCompanyId: true, mergedIntoPersonId: true },
        });
        if (!p) throw new Error("Person not found");
        // A row is a hard-delete candidate iff it's a tombstone of *some* kind.
        if (p.isActive || (p.convertedToCompanyId == null && p.mergedIntoPersonId == null)) {
            throw new Error("Only converted or merged (soft-deleted) persons can be hard-deleted");
        }
        const refs = await collectPersonRefs(id);
        if (refs.length > 0) throw new TombstoneStillReferencedError(refs);
        await prisma.person.delete({ where: { id } });
        return;
    }
    const c = await prisma.company.findUnique({
        where: { id },
        select: { id: true, isActive: true, convertedToPersonId: true, mergedIntoCompanyId: true },
    });
    if (!c) throw new Error("Company not found");
    if (c.isActive || (c.convertedToPersonId == null && c.mergedIntoCompanyId == null)) {
        throw new Error("Only converted or merged (soft-deleted) companies can be hard-deleted");
    }
    const refs = await collectCompanyRefs(id);
    if (refs.length > 0) throw new TombstoneStillReferencedError(refs);
    await prisma.company.delete({ where: { id } });
}

async function collectPersonRefs(personId: number) {
    const [account, phones, emails, links, leads, orders, cred] = await Promise.all([
        prisma.account.count({ where: { personId } }),
        prisma.phone.count({ where: { personId } }),
        prisma.email.count({ where: { personId } }),
        prisma.personCompany.count({ where: { personId } }),
        prisma.deal.count({ where: { personId } }),
        prisma.shopOrder.count({ where: { personId } }),
        prisma.personPortalCredential.count({ where: { personId } }),
    ]);
    return [
        { table: "Account", count: account },
        { table: "Phone", count: phones },
        { table: "Email", count: emails },
        { table: "PersonCompany", count: links },
        { table: "Deal", count: leads },
        { table: "ShopOrder", count: orders },
        { table: "PersonPortalCredential", count: cred },
    ].filter(r => r.count > 0);
}

async function collectCompanyRefs(companyId: number) {
    const [account, phones, emails, links, leads] = await Promise.all([
        prisma.account.count({ where: { companyId } }),
        prisma.phone.count({ where: { companyId } }),
        prisma.email.count({ where: { companyId } }),
        prisma.personCompany.count({ where: { companyId } }),
        prisma.deal.count({ where: { companyId } }),
    ]);
    return [
        { table: "Account", count: account },
        { table: "Phone", count: phones },
        { table: "Email", count: emails },
        { table: "PersonCompany", count: links },
        { table: "Deal", count: leads },
    ].filter(r => r.count > 0);
}

// ── Trash listing ────────────────────────────────────────────────────────────

export type TombstoneRow = {
    id: number;
    type: "person" | "company";
    name: string;
    /** "convert" — became a different party type; "merge" — duplicate merged into another row of the same type. */
    reason: "convert" | "merge";
    /** Date the tombstone was created (whichever of convertedAt/mergedAt is set). */
    tombstonedAt: Date;
    target: { id: number; name: string; type: "person" | "company" } | null;
};

export async function listTombstones(): Promise<TombstoneRow[]> {
    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where: {
                isActive: false,
                OR: [
                    { convertedToCompanyId: { not: null } },
                    { mergedIntoPersonId: { not: null } },
                ],
            },
            select: {
                id: true, name: true,
                convertedAt: true, convertedToCompanyId: true,
                convertedToCompany: { select: { id: true, name: true } },
                mergedAt: true, mergedIntoPersonId: true,
                mergedIntoPerson: { select: { id: true, name: true } },
            },
        }),
        prisma.company.findMany({
            where: {
                isActive: false,
                OR: [
                    { convertedToPersonId: { not: null } },
                    { mergedIntoCompanyId: { not: null } },
                ],
            },
            select: {
                id: true, name: true,
                convertedAt: true, convertedToPersonId: true,
                convertedToPerson: { select: { id: true, name: true } },
                mergedAt: true, mergedIntoCompanyId: true,
                mergedIntoCompany: { select: { id: true, name: true } },
            },
        }),
    ]);

    const rows: TombstoneRow[] = [
        ...persons.map(p => {
            const reason: "convert" | "merge" = p.mergedIntoPersonId != null ? "merge" : "convert";
            const at = (reason === "merge" ? p.mergedAt : p.convertedAt) ?? new Date(0);
            const target = reason === "merge"
                ? (p.mergedIntoPerson
                    ? { id: p.mergedIntoPerson.id, name: p.mergedIntoPerson.name, type: "person" as const }
                    : null)
                : (p.convertedToCompany
                    ? { id: p.convertedToCompany.id, name: p.convertedToCompany.name, type: "company" as const }
                    : null);
            return { id: p.id, type: "person" as const, name: p.name, reason, tombstonedAt: at, target };
        }),
        ...companies.map(c => {
            const reason: "convert" | "merge" = c.mergedIntoCompanyId != null ? "merge" : "convert";
            const at = (reason === "merge" ? c.mergedAt : c.convertedAt) ?? new Date(0);
            const target = reason === "merge"
                ? (c.mergedIntoCompany
                    ? { id: c.mergedIntoCompany.id, name: c.mergedIntoCompany.name, type: "company" as const }
                    : null)
                : (c.convertedToPerson
                    ? { id: c.convertedToPerson.id, name: c.convertedToPerson.name, type: "person" as const }
                    : null);
            return { id: c.id, type: "company" as const, name: c.name, reason, tombstonedAt: at, target };
        }),
    ];
    rows.sort((a, b) => b.tombstonedAt.getTime() - a.tombstonedAt.getTime());
    return rows;
}

// ── Merge two duplicate same-type customers ──────────────────────────────────
//
// Loser's Account is dissolved: every JournalLine / VoucherLine / InvVoucher{,Charge,Tender}
// / Voucher.partyAccountId / Ticket.billingAccountId / Device.accountId / ShopOrder.accountId
// is re-pointed at the winner's Account, then the loser Account row is deleted.
// The loser party row is soft-deleted with a mergedInto*Id back-link and shows
// up in the Trash view alongside conversion tombstones.

export type MergeKind = "person" | "company";

export type MergeBlocker =
    | { kind: "notFound"; side: "winner" | "loser" }
    | { kind: "sameId" }
    | { kind: "sourceInactive"; side: "winner" | "loser" }
    | { kind: "alreadyTombstoned"; side: "winner" | "loser" }
    | { kind: "noAccount"; side: "winner" | "loser" }
    | { kind: "accountIsTillOrVault"; usage: string }
    | { kind: "accountIsParent"; childCount: number };

export type MergePreview = {
    kind: MergeKind;
    winnerId: number;
    loserId: number;
    winnerName: string;
    loserName: string;
    winnerAccountId: number | null;
    loserAccountId: number | null;
    /** Account FK references that will be re-pointed onto the winner's Account. */
    accountRefs: {
        journalLines: number;
        voucherParty: number;
        voucherLines: number;
        invVouchers: number;
        invVoucherCharges: number;
        invVoucherTenders: number;
        tickets: number;
        devices: number;
        shopOrders: number;
    };
    /** Party FK references that will move from loser → winner (Phone, Email, Deal, links). */
    partyRefs: {
        phones: number;
        emails: number;
        deals: number;
        personCompanyLinks: number;
        shopOrdersPersonId: number;
        portalCredential: boolean;
    };
    blockers: MergeBlocker[];
};

export type MergeResult = {
    kind: MergeKind;
    winnerId: number;
    winnerAccountId: number | null;
    loserId: number;
    loserAccountId: number;
    movedCounts: MergePreview["accountRefs"] & {
        phones: number;
        emails: number;
        deals: number;
        personCompanyLinks: number;
        portalCredentialDropped: number;
    };
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

async function loadPersonForMerge(id: number) {
    return prisma.person.findUnique({
        where: { id },
        select: {
            id: true, name: true, isActive: true,
            convertedToCompanyId: true, mergedIntoPersonId: true,
            account: { select: { id: true } },
        },
    });
}

async function loadCompanyForMerge(id: number) {
    return prisma.company.findUnique({
        where: { id },
        select: {
            id: true, name: true, isActive: true,
            convertedToPersonId: true, mergedIntoCompanyId: true,
            account: { select: { id: true } },
        },
    });
}

export async function previewMerge(
    kind: MergeKind,
    winnerId: number,
    loserId: number,
): Promise<MergePreview> {
    const blockers: MergeBlocker[] = [];
    if (winnerId === loserId) blockers.push({ kind: "sameId" });

    const winner = kind === "person" ? await loadPersonForMerge(winnerId) : await loadCompanyForMerge(winnerId);
    const loser = kind === "person" ? await loadPersonForMerge(loserId) : await loadCompanyForMerge(loserId);
    if (!winner) blockers.push({ kind: "notFound", side: "winner" });
    if (!loser) blockers.push({ kind: "notFound", side: "loser" });

    const winnerName = winner?.name ?? "—";
    const loserName = loser?.name ?? "—";
    const winnerAccountId = winner?.account?.id ?? null;
    const loserAccountId = loser?.account?.id ?? null;

    if (winner && !winner.isActive) blockers.push({ kind: "sourceInactive", side: "winner" });
    if (loser && !loser.isActive) blockers.push({ kind: "sourceInactive", side: "loser" });
    type Tombstoned = {
        convertedToCompanyId?: number | null;
        convertedToPersonId?:  number | null;
        mergedIntoPersonId?:   number | null;
        mergedIntoCompanyId?:  number | null;
    };
    if (winner) {
        const w = winner as Tombstoned;
        if (w.convertedToCompanyId != null
            || w.convertedToPersonId != null
            || w.mergedIntoPersonId != null
            || w.mergedIntoCompanyId != null) {
            blockers.push({ kind: "alreadyTombstoned", side: "winner" });
        }
    }
    if (loser) {
        const l = loser as Tombstoned;
        if (l.convertedToCompanyId != null
            || l.convertedToPersonId != null
            || l.mergedIntoPersonId != null
            || l.mergedIntoCompanyId != null) {
            blockers.push({ kind: "alreadyTombstoned", side: "loser" });
        }
    }
    if (winner && !winnerAccountId) blockers.push({ kind: "noAccount", side: "winner" });
    if (loser && !loserAccountId) blockers.push({ kind: "noAccount", side: "loser" });

    if (loserAccountId) {
        blockers.push(...(await partyAccountUsage(loserAccountId)));
    }

    const partyWhere = kind === "person" ? { personId: loserId } : { companyId: loserId };
    const linkWhere = kind === "person" ? { personId: loserId } : { companyId: loserId };
    const leadWhere = kind === "person" ? { personId: loserId } : { companyId: loserId };

    const [phones, emails, links, leads] = await Promise.all([
        prisma.phone.count({ where: partyWhere }),
        prisma.email.count({ where: partyWhere }),
        prisma.personCompany.count({ where: linkWhere }),
        prisma.deal.count({ where: leadWhere }),
    ]);
    const shopOrdersPerson = kind === "person"
        ? await prisma.shopOrder.count({ where: { personId: loserId } })
        : 0;
    const portalCred = kind === "person"
        ? (await prisma.personPortalCredential.count({ where: { personId: loserId } })) > 0
        : false;

    // Account-FK ref counts (loser side). Empty zeros if no loser account.
    const accountRefs = loserAccountId
        ? await countAccountRefs(loserAccountId)
        : { journalLines: 0, voucherParty: 0, voucherLines: 0, invVouchers: 0, invVoucherCharges: 0, invVoucherTenders: 0, tickets: 0, devices: 0, shopOrders: 0 };

    return {
        kind, winnerId, loserId, winnerName, loserName, winnerAccountId, loserAccountId,
        accountRefs,
        partyRefs: { phones, emails, deals: leads, personCompanyLinks: links, shopOrdersPersonId: shopOrdersPerson, portalCredential: portalCred },
        blockers,
    };
}

async function countAccountRefs(accountId: number) {
    const [jl, vp, vl, iv, t, d, so, settlementRows] = await Promise.all([
        prisma.voucherGlLine.count({ where: { accountId } }),   // Phase 4 G3: GL activity from the spine
        // Phase 5 5E: party + GL lines live on the spine (Voucher/VoucherLine dropped).
        prisma.universalVoucher.count({ where: { partyAccountId: accountId } }),
        Promise.resolve(0),   // legacy VoucherLine refs are now the spine GL lines (counted as `jl`)
        // Phase 5 5D-4: InvVoucher party is on the spine — count via the relation.
        prisma.voucherDetail.count({ where: { universalVoucher: { partyAccountId: accountId } } }),
        prisma.ticket.count({ where: { billingAccountId: accountId } }),
        prisma.device.count({ where: { accountId } }),
        prisma.shopOrder.count({ where: { accountId } }),
        // G4b: tender/charge input lives in settlementJson now — scan for refs.
        prisma.voucherDetail.findMany({ where: { settlementJson: { not: Prisma.DbNull } }, select: { settlementJson: true } }),
    ]);
    let ivc = 0, ivt = 0;
    for (const r of settlementRows) {
        const s = readSettlement(r.settlementJson);
        ivc += s.charges.filter((c) => c.accountId === accountId).length;
        ivt += s.tenders.filter((t2) => t2.accountId === accountId).length;
    }
    return {
        journalLines: jl, voucherParty: vp, voucherLines: vl,
        invVouchers: iv, invVoucherCharges: ivc, invVoucherTenders: ivt,
        tickets: t, devices: d, shopOrders: so,
    };
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

    return prisma.$transaction(async (tx) => {
        // 1. Re-point every Account FK from loser's Account → winner's Account.
        const [jl, vp, vl, iv, gll, t, d, so] = await Promise.all([
            Promise.resolve({ count: 0 }),   // G5: JournalLine dropped — spine re-point is `gll` below
            // Phase 5 5E: party lives on the spine; VoucherLine is the spine GL line.
            tx.universalVoucher.updateMany({ where: { partyAccountId: loserAccountId }, data: { partyAccountId: winnerAccountId } }),
            Promise.resolve({ count: 0 }),   // 5E: legacy VoucherLine re-point folded into `gll` below
            // 5D-4: InvVoucher party is on the spine — the universalVoucher re-point (vp) covers it.
            Promise.resolve({ count: 0 }),
            // G4b: re-point the spine GL lines (covers role=TENDER/CHARGE + body legs
            // pointing at the loser ledger — the InvVoucherTender/Charge tables retired).
            tx.voucherGlLine.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } }),
            tx.ticket.updateMany({ where: { billingAccountId: loserAccountId }, data: { billingAccountId: winnerAccountId } }),
            tx.device.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } }),
            tx.shopOrder.updateMany({ where: { accountId: loserAccountId }, data: { accountId: winnerAccountId } }),
        ]);

        // G4b: re-point tender/charge input inside settlementJson (drafts + posted echo).
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
                ) },
            });
        }

        // 2. Roll the loser's cached balance + opening balance into the winner.
        //    Cached `Account.balance` is read by dashboards. `openingBalance`
        //    (signed by `openingBalanceType` Dr/Cr) is the master figure
        //    re-posted at books-beginning; merging duplicates must sum it too
        //    or the winner's "started with X" line would silently lose Y.
        const accountSelect = {
            balance: true,
            openingBalance: true,
            openingBalanceType: true,
            openingBalanceDate: true,
        } as const;
        const [winnerAcct, loserAcct] = await Promise.all([
            tx.account.findUniqueOrThrow({ where: { id: winnerAccountId }, select: accountSelect }),
            tx.account.findUniqueOrThrow({ where: { id: loserAccountId }, select: accountSelect }),
        ]);

        // Cached balance — straight sum (both are already signed in the same direction).
        const summedBalance = Number(winnerAcct.balance) + Number(loserAcct.balance);

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

        // Date: prefer the earlier non-null opening date so historical entries
        // stay anchored to whichever party started keeping books first.
        const dates = [winnerAcct.openingBalanceDate, loserAcct.openingBalanceDate].filter((d): d is Date => d != null);
        const openDate = dates.length > 0
            ? new Date(Math.min(...dates.map(d => d.getTime())))
            : null;

        await tx.account.update({
            where: { id: winnerAccountId },
            data: {
                balance: summedBalance.toFixed(2),
                openingBalance: openMag === 0 ? null : openMag.toFixed(2),
                openingBalanceType: openType,
                openingBalanceDate: openDate,
            },
        });

        // 3. Move Phone / Email rows from loser onto winner. Global @unique on
        //    `phone` / `email` is satisfied because duplicate parties don't
        //    share contact values (that's how they ended up as two rows).
        const partyKey = kind === "person" ? "personId" : "companyId";
        const partyMoveData: Record<string, number | null> =
            kind === "person"
                ? { personId: winnerId, companyId: null }
                : { companyId: winnerId, personId: null };

        const phones = await tx.phone.updateMany({ where: { [partyKey]: loserId }, data: partyMoveData });
        const emails = await tx.email.updateMany({ where: { [partyKey]: loserId }, data: partyMoveData });

        // 4. PersonCompany links: move loser's onto winner. Dedupe by (personId,
        //    companyId) since the same pair could now appear twice.
        const links = await tx.personCompany.updateMany({
            where: { [partyKey]: loserId },
            data: { [partyKey]: winnerId },
        });
        await dedupePersonCompanyLinks(tx);

        // 5. Deal: re-point.
        const leads = await tx.deal.updateMany({
            where: { [partyKey]: loserId },
            data: { [partyKey]: winnerId },
        });

        // 6. ShopOrder.personId (Person merges only).
        if (kind === "person") {
            await tx.shopOrder.updateMany({
                where: { personId: loserId },
                data: { personId: winnerId },
            });
        }

        // 7. PortalCredential — keep winner's, drop loser's (decision recorded
        //    in commit history; see customer-tools plan).
        let credDropped = 0;
        if (kind === "person") {
            const r = await tx.personPortalCredential.deleteMany({ where: { personId: loserId } });
            credDropped = r.count;
        }

        // 8. Drop the loser's Account (now orphaned — every FK was moved).
        await tx.account.delete({ where: { id: loserAccountId } });

        // 9. Soft-delete the loser party with the merge back-link.
        const stamp = { isActive: false, mergedAt: new Date() } as const;
        if (kind === "person") {
            await tx.person.update({
                where: { id: loserId },
                data: { ...stamp, mergedIntoPersonId: winnerId },
            });
        } else {
            await tx.company.update({
                where: { id: loserId },
                data: { ...stamp, mergedIntoCompanyId: winnerId },
            });
        }

        return {
            kind,
            winnerId, winnerAccountId,
            loserId, loserAccountId,
            movedCounts: {
                journalLines: jl.count,
                voucherParty: vp.count,
                voucherLines: vl.count,
                invVouchers: iv.count,
                invVoucherCharges: ivc,
                invVoucherTenders: ivt,
                voucherGlLines: gll.count,
                tickets: t.count,
                devices: d.count,
                shopOrders: so.count,
                phones: phones.count,
                emails: emails.count,
                deals: leads.count,
                personCompanyLinks: links.count,
                portalCredentialDropped: credDropped,
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
