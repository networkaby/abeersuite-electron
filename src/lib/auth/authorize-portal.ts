import type { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import {
    isLikelyEmail,
    normalizePortalEmail,
    normalizePortalPhone,
} from "@/lib/auth/portal-identifier";

export type PortalAuthUser = {
    id: string;
    name: string;
    email: string;
    role: string;
    roles: string[];
    permissions: string[];
    rank: number;
    scope: string;
    kind: "customer";
    customerId: string;
    activeAccountId?: string;
    activeAccountType?: "personal" | "company";
};

export async function authorizePortalCredentials(
    prisma: PrismaClient,
    identifier: string,
    password: string
): Promise<PortalAuthUser | null> {
    const raw = identifier.trim();
    if (!raw || !password) return null;

    let cred = null;
    if (isLikelyEmail(raw)) {
        const emailNorm = normalizePortalEmail(raw);
        cred = await prisma.personPortalCredential.findFirst({
            where: { emailNormalized: emailNorm },
            include: {
                person: {
                    include: {
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    },
                },
            },
        });
    } else {
        const phoneNorm = normalizePortalPhone(raw);
        if (!phoneNorm) return null;
        cred = await prisma.personPortalCredential.findFirst({
            where: { phoneNormalized: phoneNorm },
            include: {
                person: {
                    include: {
                        emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    },
                },
            },
        });
    }

    if (!cred) return null;

    const ok = await bcrypt.compare(password, cred.passwordHash);
    if (!ok) return null;

    const p = cred.person;
    const personalAccount = await prisma.account.findUnique({
        where: { personId: p.id },
        select: { id: true },
    });

    return {
        id: String(p.id),
        name: p.name,
        email: p.emails[0]?.email ?? "",
        role: "",
        roles: [],
        permissions: [],
        rank: 0,
        scope: "OWN",
        kind: "customer",
        customerId: String(p.id),
        activeAccountId: personalAccount ? String(personalAccount.id) : undefined,
        activeAccountType: "personal",
    };
}
