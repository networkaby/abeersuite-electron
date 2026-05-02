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
        cred = await prisma.customerPortalCredential.findFirst({
            where: { emailNormalized: emailNorm },
            include: { customer: true },
        });
    } else {
        const phoneNorm = normalizePortalPhone(raw);
        if (!phoneNorm) return null;
        cred = await prisma.customerPortalCredential.findFirst({
            where: { phoneNormalized: phoneNorm },
            include: { customer: true },
        });
    }

    if (!cred) return null;

    const ok = await bcrypt.compare(password, cred.passwordHash);
    if (!ok) return null;

    const c = cred.customer;
    return {
        id: String(c.id),
        name: c.name,
        email: c.email ?? "",
        role: "",
        roles: [],
        permissions: [],
        rank: 0,
        scope: "OWN",
        kind: "customer",
        customerId: String(c.id),
    };
}
