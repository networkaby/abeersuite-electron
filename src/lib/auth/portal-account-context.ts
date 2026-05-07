import { prisma } from "@/lib/prisma";

export const PORTAL_ACTIVE_ACCOUNT_COOKIE = "portal_active_account_id";

export type PortalAccountType = "personal" | "company";

export type PortalAccountOption = {
    accountId: number;
    accountType: PortalAccountType;
    label: string;
    companyId: number | null;
    companyName: string | null;
};

export type PortalAccountContext = {
    customerId: number;
    options: PortalAccountOption[];
    active: PortalAccountOption;
};

async function ensurePersonalAccount(personId: number, personName: string) {
    return prisma.account.upsert({
        where: { personId },
        update: {},
        create: {
            personId,
            name: personName,
        },
        select: { id: true },
    });
}

export async function getPortalAccountOptions(customerId: number): Promise<PortalAccountOption[]> {
    const person = await prisma.person.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            name: true,
            account: { select: { id: true } },
            companies: {
                where: { unlinkedAt: null },
                select: {
                    company: {
                        select: {
                            id: true,
                            name: true,
                            account: { select: { id: true } },
                        },
                    },
                },
            },
        },
    });

    if (!person) return [];

    const personalAccount = person.account ?? (await ensurePersonalAccount(person.id, person.name));
    const options: PortalAccountOption[] = [
        {
            accountId: personalAccount.id,
            accountType: "personal",
            label: `${person.name} (Personal)`,
            companyId: null,
            companyName: null,
        },
    ];

    for (const link of person.companies) {
        const company = link.company;
        if (!company.account) continue;
        options.push({
            accountId: company.account.id,
            accountType: "company",
            label: company.name,
            companyId: company.id,
            companyName: company.name,
        });
    }

    return options;
}

export async function resolvePortalAccountContext(
    customerId: number,
    preferredAccountId?: number | null
): Promise<PortalAccountContext> {
    const options = await getPortalAccountOptions(customerId);
    if (options.length === 0) {
        throw new Error("No account context available");
    }
    const personal = options.find((option) => option.accountType === "personal") ?? options[0];
    const active = preferredAccountId
        ? (options.find((option) => option.accountId === preferredAccountId) ?? personal)
        : personal;

    return {
        customerId,
        options,
        active,
    };
}

