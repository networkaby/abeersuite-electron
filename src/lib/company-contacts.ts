// Aggregate a company's contact info from its own Phone/Email rows plus the
// rows owned by linked-active persons. Used by GET /api/companies/[id] and
// any list endpoint that needs to display a company's full reachable contacts.

import { prisma } from "@/lib/prisma";

export type ContactRow = {
    id: number;
    value: string;
    label: string | null;
    isPrimary: boolean;
};

export type DerivedContactRow = ContactRow & {
    fromPersonId: number;
    fromPersonName: string;
};

export async function getCompanyContacts(companyId: number) {
    const [own, linkedPersons] = await Promise.all([
        prisma.company.findUnique({
            where: { id: companyId },
            select: {
                phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            },
        }),
        prisma.personCompany.findMany({
            where: { companyId, unlinkedAt: null, person: { isActive: true } },
            include: {
                person: {
                    select: {
                        id: true,
                        name: true,
                        phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
                    },
                },
            },
        }),
    ]);

    const phones: ContactRow[] = (own?.phones ?? []).map(p => ({
        id: p.id,
        value: p.phone,
        label: p.label,
        isPrimary: p.isPrimary,
    }));
    const emails: ContactRow[] = (own?.emails ?? []).map(e => ({
        id: e.id,
        value: e.email,
        label: e.label,
        isPrimary: e.isPrimary,
    }));

    const derivedPhones: DerivedContactRow[] = [];
    const derivedEmails: DerivedContactRow[] = [];

    for (const link of linkedPersons) {
        for (const p of link.person.phones) {
            derivedPhones.push({
                id: p.id,
                value: p.phone,
                label: p.label,
                isPrimary: p.isPrimary,
                fromPersonId: link.person.id,
                fromPersonName: link.person.name,
            });
        }
        for (const e of link.person.emails) {
            derivedEmails.push({
                id: e.id,
                value: e.email,
                label: e.label,
                isPrimary: e.isPrimary,
                fromPersonId: link.person.id,
                fromPersonName: link.person.name,
            });
        }
    }

    const primaryContactName = linkedPersons[0]?.person.name ?? null;

    return { phones, emails, derivedPhones, derivedEmails, primaryContactName };
}
