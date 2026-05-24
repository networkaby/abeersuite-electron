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
import type { Prisma } from "@/generated/prisma";

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
        crmLeads: number;
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
        crmLeads: number;
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
                crmLeads: { select: { id: true } },
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
                crmLeads: p.crmLeads.length,
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
            crmLeads: { select: { id: true } },
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
            crmLeads: c.crmLeads.length,
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
        counts: { phones: 0, emails: 0, crmLeads: 0, personCompanyLinks: 0, shopOrders: 0, portalCredential: false },
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

        // CrmLead already carries both personId and companyId nullable — flip.
        const leadsMoved = await tx.crmLead.updateMany({
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
                crmLeads: leadsMoved.count,
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

        const leadsMoved = await tx.crmLead.updateMany({
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
                crmLeads: leadsMoved.count,
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
            select: { id: true, isActive: true, convertedToCompanyId: true },
        });
        if (!p) throw new Error("Person not found");
        if (p.isActive || p.convertedToCompanyId == null) {
            throw new Error("Only converted (soft-deleted) persons can be hard-deleted");
        }
        const refs = await collectPersonRefs(id);
        if (refs.length > 0) throw new TombstoneStillReferencedError(refs);
        await prisma.person.delete({ where: { id } });
        return;
    }
    const c = await prisma.company.findUnique({
        where: { id },
        select: { id: true, isActive: true, convertedToPersonId: true },
    });
    if (!c) throw new Error("Company not found");
    if (c.isActive || c.convertedToPersonId == null) {
        throw new Error("Only converted (soft-deleted) companies can be hard-deleted");
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
        prisma.crmLead.count({ where: { personId } }),
        prisma.shopOrder.count({ where: { personId } }),
        prisma.personPortalCredential.count({ where: { personId } }),
    ]);
    return [
        { table: "Account", count: account },
        { table: "Phone", count: phones },
        { table: "Email", count: emails },
        { table: "PersonCompany", count: links },
        { table: "CrmLead", count: leads },
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
        prisma.crmLead.count({ where: { companyId } }),
    ]);
    return [
        { table: "Account", count: account },
        { table: "Phone", count: phones },
        { table: "Email", count: emails },
        { table: "PersonCompany", count: links },
        { table: "CrmLead", count: leads },
    ].filter(r => r.count > 0);
}

// ── Trash listing ────────────────────────────────────────────────────────────

export type TombstoneRow = {
    id: number;
    type: "person" | "company";
    name: string;
    convertedAt: Date;
    target: { id: number; name: string; type: "person" | "company" } | null;
};

export async function listTombstones(): Promise<TombstoneRow[]> {
    const [persons, companies] = await Promise.all([
        prisma.person.findMany({
            where: { isActive: false, convertedToCompanyId: { not: null } },
            select: {
                id: true, name: true, convertedAt: true, convertedToCompanyId: true,
                convertedToCompany: { select: { id: true, name: true } },
            },
            orderBy: { convertedAt: "desc" },
        }),
        prisma.company.findMany({
            where: { isActive: false, convertedToPersonId: { not: null } },
            select: {
                id: true, name: true, convertedAt: true, convertedToPersonId: true,
                convertedToPerson: { select: { id: true, name: true } },
            },
            orderBy: { convertedAt: "desc" },
        }),
    ]);

    const rows: TombstoneRow[] = [
        ...persons.map(p => ({
            id: p.id,
            type: "person" as const,
            name: p.name,
            convertedAt: p.convertedAt ?? new Date(0),
            target: p.convertedToCompany
                ? { id: p.convertedToCompany.id, name: p.convertedToCompany.name, type: "company" as const }
                : null,
        })),
        ...companies.map(c => ({
            id: c.id,
            type: "company" as const,
            name: c.name,
            convertedAt: c.convertedAt ?? new Date(0),
            target: c.convertedToPerson
                ? { id: c.convertedToPerson.id, name: c.convertedToPerson.name, type: "person" as const }
                : null,
        })),
    ];
    rows.sort((a, b) => b.convertedAt.getTime() - a.convertedAt.getTime());
    return rows;
}
