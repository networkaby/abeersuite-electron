import "server-only";

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";
import { getPortalAccountOptions } from "@/shared/lib/auth/portalAccountContext";
import type { PortalContact, PortalProfile } from "@/shared/lib/portal/portalProfileTypes";

/**
 * The customer's own profile as the portal shows it — one read, one shape.
 *
 * Contacts carry two flags the customer needs to understand the rules on the
 * page: `verified` (staff-entered or OTP-proved — may be primary, may sign in)
 * and `isLogin` (the mobile/email their password login is bound to — cannot be
 * removed without first moving the login elsewhere).
 */

export type { PortalContact, PortalProfile };

const contactOrder = [{ isPrimary: "desc" as const }, { id: "asc" as const }];

export async function loadPortalProfile(customerId: number, activeAccountId: number): Promise<PortalProfile | null> {
    const [person, profiles] = await Promise.all([
        prisma.person.findUnique({
            where: { id: customerId },
            select: {
                id: true,
                name: true,
                address: true,
                avatarUrl: true,
                phones: { orderBy: contactOrder, select: { id: true, phone: true, isPrimary: true, verifiedAt: true } },
                emails: { orderBy: contactOrder, select: { id: true, email: true, isPrimary: true, verifiedAt: true } },
                socialProfile: { select: { handle: true } },
                portalCredential: { select: { phoneNormalized: true, emailNormalized: true } },
            },
        }),
        getPortalAccountOptions(customerId),
    ]);
    if (!person) return null;

    const cred = person.portalCredential;
    return {
        id: person.id,
        name: person.name,
        address: person.address,
        avatarUrl: person.avatarUrl,
        phones: person.phones.map((p) => ({
            id: p.id,
            value: p.phone,
            isPrimary: p.isPrimary,
            verified: p.verifiedAt !== null,
            isLogin: !!cred?.phoneNormalized && normalizePortalPhone(p.phone) === cred.phoneNormalized,
        })),
        emails: person.emails.map((e) => ({
            id: e.id,
            value: e.email,
            isPrimary: e.isPrimary,
            verified: e.verifiedAt !== null,
            isLogin: !!cred?.emailNormalized && normalizePortalEmail(e.email) === cred.emailNormalized,
        })),
        profiles,
        activeAccountId,
        social: person.socialProfile ? { handle: person.socialProfile.handle } : null,
        hasPassword: cred !== null,
    };
}

/** The customer's own row for a normalized value, if they have one. */
export async function findOwnPhone(customerId: number, phoneNormalized: string) {
    const rows = await prisma.phone.findMany({
        where: { personId: customerId },
        select: { id: true, phone: true, verifiedAt: true },
    });
    return rows.find((r) => normalizePortalPhone(r.phone) === phoneNormalized) ?? null;
}

export async function findOwnEmail(customerId: number, emailNormalized: string) {
    return prisma.email.findFirst({
        where: { personId: customerId, email: { equals: emailNormalized, mode: "insensitive" } },
        select: { id: true, email: true, verifiedAt: true },
    });
}

/**
 * Bind the password login to a freshly verified channel when that column is
 * still empty — so "verify my email" also makes "sign in with email + password"
 * work, the same guarded write the register route does. Unique columns, so a
 * clash (another credential owns it) is simply left alone.
 */
export async function bindLoginChannel(customerId: number, identity: { phoneNormalized?: string | null; emailNormalized?: string | null }) {
    const cred = await prisma.personPortalCredential.findUnique({
        where: { personId: customerId },
        select: { phoneNormalized: true, emailNormalized: true },
    });
    if (!cred) return;
    const data = {
        ...(identity.phoneNormalized && !cred.phoneNormalized ? { phoneNormalized: identity.phoneNormalized } : {}),
        ...(identity.emailNormalized && !cred.emailNormalized ? { emailNormalized: identity.emailNormalized } : {}),
    };
    if (Object.keys(data).length === 0) return;
    await prisma.personPortalCredential.update({ where: { personId: customerId }, data }).catch(() => { /* owned elsewhere */ });
}

/** Undo `bindLoginChannel` for a contact being removed. */
export async function unbindLoginChannel(customerId: number, identity: { phoneNormalized?: string | null; emailNormalized?: string | null }) {
    const cred = await prisma.personPortalCredential.findUnique({
        where: { personId: customerId },
        select: { phoneNormalized: true, emailNormalized: true },
    });
    if (!cred) return;
    const data = {
        ...(identity.phoneNormalized && cred.phoneNormalized === identity.phoneNormalized ? { phoneNormalized: null } : {}),
        ...(identity.emailNormalized && cred.emailNormalized === identity.emailNormalized ? { emailNormalized: null } : {}),
    };
    if (Object.keys(data).length === 0) return;
    await prisma.personPortalCredential.update({ where: { personId: customerId }, data });
}
