import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { selectPrimaryEmail } from "@/shared/lib/prisma/fragments";
import { findPortalPerson } from "@/shared/lib/auth/findPortalPerson";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";
import { readTicket } from "@/shared/lib/auth/otpChallenge";
import { verifyFirebaseIdToken } from "@/shared/lib/auth/firebaseToken";
import type { PortalAuthUser } from "@/shared/lib/auth/authorizePortal";

/**
 * Passwordless portal sign-in: turn a verified token into a session user.
 *
 * Two token flavours, one shape out:
 *   SMS / email OTP → our own ticket (HMAC, issued by /api/portal/otp/verify)
 *   Google          → Firebase ID token carrying a verified email
 *
 * A ticket is tried first and carries its own channel, so a mobile ticket can
 * never be replayed as an email identity. Only if the token is not a valid
 * ticket do we fall back to Firebase — which is now Google-only.
 *
 * Unknown-but-verified identities are NOT rejected: with `name` supplied we
 * create the Person + contact row + Account, mirroring /api/portal/register
 * (cash-only until staff grant a limit). Without a name we report
 * `needsOnboarding` so the UI can ask for one.
 */

/** What the verified token proves. */
export type PortalIdentity = {
    channel: "mobile" | "email";
    phoneNormalized: string | null;
    emailNormalized: string | null;
};

export type PasswordlessResult =
    | { status: "invalid" }
    | { status: "needsOnboarding"; identity: PortalIdentity }
    | { status: "ok"; user: PortalAuthUser };

/**
 * Verify the token and say who it belongs to. Never trusts a client-supplied
 * identifier — the phone/email always comes out of the verified token.
 */
export async function resolvePortalIdentity(token: string): Promise<PortalIdentity | null> {
    if (!token) return null;

    // Our own OTP ticket (SMS or email). It carries its own channel, so the
    // client cannot claim a different one than it actually verified.
    const ticket = readTicket(token);
    if (ticket) {
        return ticket.channel === "email"
            ? {
                  channel: "email",
                  emailNormalized: normalizePortalEmail(ticket.identity),
                  phoneNormalized: null,
              }
            : {
                  channel: "mobile",
                  phoneNormalized: normalizePortalPhone(ticket.identity),
                  emailNormalized: null,
              };
    }

    // Not a ticket → the only other issuer is Firebase, i.e. Google sign-in.
    const verified = await verifyFirebaseIdToken(token);
    if (!verified?.email) return null;
    return {
        channel: "email",
        emailNormalized: normalizePortalEmail(verified.email),
        phoneNormalized: null,
    };
}

/** Build the session user for a known Person. */
async function toAuthUser(prisma: PrismaClient, personId: number): Promise<PortalAuthUser | null> {
    const person = await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true, name: true, emails: selectPrimaryEmail },
    });
    if (!person) return null;

    const personalAccount = await prisma.account.findUnique({
        where: { personId: person.id },
        select: { id: true },
    });

    return {
        id: String(person.id),
        name: person.name,
        email: person.emails[0]?.email ?? "",
        role: "",
        roles: [],
        permissions: [],
        rank: 0,
        scope: "OWN",
        kind: "customer",
        customerId: String(person.id),
        activeAccountId: personalAccount ? String(personalAccount.id) : undefined,
        activeAccountType: "personal",
    };
}

/**
 * Create a customer from a verified identity. Same shape as self-registration:
 * Person + primary contact + cash-only Account, all in one transaction.
 */
async function onboardPerson(
    prisma: PrismaClient,
    identity: PortalIdentity,
    name: string,
    extraContact: string
): Promise<number> {
    // The optional second contact the onboarding form offers.
    const extraEmail =
        identity.channel === "mobile" && extraContact.includes("@")
            ? normalizePortalEmail(extraContact)
            : null;
    const extraPhone =
        identity.channel === "email" && extraContact ? normalizePortalPhone(extraContact) : null;

    const created = await prisma.$transaction(async (tx) => {
        const person = await tx.person.create({ data: { name } });

        const phone = identity.phoneNormalized ?? extraPhone;
        if (phone) {
            await tx.phone.create({
                data: { phone: `+91${phone}`, personId: person.id, isPrimary: true },
            });
        }
        const email = identity.emailNormalized ?? extraEmail;
        if (email) {
            await tx.email.create({ data: { email, personId: person.id, isPrimary: true } });
        }

        await tx.account.create({
            // Self-onboarded portal customer — cash-only (creditLimit 0) until
            // staff explicitly grant a positive limit.
            data: { personId: person.id, name: person.name, creditLimit: 0 },
        });
        return person;
    });

    return created.id;
}

/**
 * Full sign-in. `name` non-empty means "create if missing" (the onboarding
 * form was filled in); empty means "only sign in if you already know me".
 */
export async function authorizePortalPasswordless(
    prisma: PrismaClient,
    args: { token: string; name?: string; extraContact?: string }
): Promise<PasswordlessResult> {
    // The channel comes out of the verified token, never from the caller.
    const identity = await resolvePortalIdentity(args.token);
    if (!identity) return { status: "invalid" };

    const existing = await findPortalPerson(prisma, identity);
    if (existing) {
        const user = await toAuthUser(prisma, existing.id);
        return user ? { status: "ok", user } : { status: "invalid" };
    }

    const name = (args.name ?? "").trim();
    if (!name) return { status: "needsOnboarding", identity };

    const personId = await onboardPerson(prisma, identity, name, (args.extraContact ?? "").trim());
    const user = await toAuthUser(prisma, personId);
    return user ? { status: "ok", user } : { status: "invalid" };
}
