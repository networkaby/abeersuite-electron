import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { canonicalPhone } from "@/shared/lib/format/phone";
import { normalizePortalEmail, normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";

/**
 * Resolve a Person from a portal login identifier (already normalized).
 *
 * Shared by self-registration and passwordless sign-in so both agree on who an
 * identifier belongs to — one lookup, one answer.
 *
 * Phone matching is the awkward part: `Phone.phone` is stored in whatever shape
 * it was entered ("+919876543210", "09876543210", "98765 43210"), so an exact
 * match is unreliable. We query the plausible written forms rather than pulling
 * rows and normalising in JS — the previous `take: 500` scan silently stopped
 * matching once the 501st person existed.
 */

type FoundPerson = { id: number; name: string } | null;

/**
 * A lookup result that also says WHY nobody was found. `unverified` means the
 * identifier IS on a customer's profile, but as a contact they typed into the
 * portal themselves without an OTP — so it must not sign them in, register, or
 * reset a password (see Phone.verifiedAt). The UI tells them to verify it from
 * My Profile after signing in another way.
 */
export type PortalPersonMatch =
    | { status: "found"; person: { id: number; name: string } }
    | { status: "unverified" }
    | { status: "none" };

type Db = PrismaClient | Prisma.TransactionClient;

/** Written variants of a 10-digit Indian number that may sit in the DB. */
function phoneVariants(digits: string): string[] {
    const variants = new Set<string>([digits, `+91${digits}`, `91${digits}`, `0${digits}`]);
    return [...variants];
}

/** Find by email (case-insensitive). Only a verified row identifies a person. */
export async function findPersonByPortalEmail(db: Db, emailNormalized: string): Promise<PortalPersonMatch> {
    const match = await db.email.findFirst({
        where: { email: { equals: emailNormalized, mode: "insensitive" }, personId: { not: null } },
        select: { verifiedAt: true, person: { select: { id: true, name: true } } },
    });
    if (!match?.person) return { status: "none" };
    return match.verifiedAt ? { status: "found", person: match.person } : { status: "unverified" };
}

/** Find by mobile, tolerating the various stored formats. Only a verified row identifies a person. */
export async function findPersonByPortalPhone(db: Db, phoneNormalized: string): Promise<PortalPersonMatch> {
    const digits = normalizePortalPhone(phoneNormalized) ?? phoneNormalized;

    // Exact hits on the common written forms first — index-friendly.
    const exact = await db.phone.findFirst({
        where: { personId: { not: null }, phone: { in: phoneVariants(digits) } },
        select: { verifiedAt: true, person: { select: { id: true, name: true } } },
    });
    if (exact?.person) {
        return exact.verifiedAt ? { status: "found", person: exact.person } : { status: "unverified" };
    }

    // Fall back to spacing/punctuation variants ("98765 43210", "+91-98765-43210").
    // `endsWith` keeps this a single indexed-ish query instead of a table scan in JS,
    // then we confirm by normalising the few candidates it returns.
    const candidates = await db.phone.findMany({
        where: { personId: { not: null }, phone: { endsWith: digits.slice(-6) } },
        select: { phone: true, verifiedAt: true, person: { select: { id: true, name: true } } },
        take: 50,
    });
    const hit = candidates.find((row) => row.phone && normalizePortalPhone(row.phone) === digits);
    if (!hit?.person) return { status: "none" };
    return hit.verifiedAt ? { status: "found", person: hit.person } : { status: "unverified" };
}

/** Email takes precedence when both are supplied. */
export async function matchPortalPerson(
    db: Db,
    identity: { emailNormalized?: string | null; phoneNormalized?: string | null }
): Promise<PortalPersonMatch> {
    if (identity.emailNormalized) {
        const byEmail = await findPersonByPortalEmail(db, identity.emailNormalized);
        if (byEmail.status !== "none") return byEmail;
    }
    if (identity.phoneNormalized) {
        return findPersonByPortalPhone(db, identity.phoneNormalized);
    }
    return { status: "none" };
}

/** Convenience: the person, or null when unknown OR only unverified. */
export async function findPortalPerson(
    db: Db,
    identity: { emailNormalized?: string | null; phoneNormalized?: string | null }
): Promise<FoundPerson> {
    const match = await matchPortalPerson(db, identity);
    return match.status === "found" ? match.person : null;
}

// ── Find or create ───────────────────────────────────────────────────────────

/** What a verified token proves about the customer. */
export type PortalContactIdentity = {
    emailNormalized?: string | null;
    phoneNormalized?: string | null;
};

/**
 * Attach a contact row, shrugging off the unique clash when it already exists.
 * `verified` is true only for the channel the OTP just proved; the optional
 * "other contact" typed on the onboarding form is taken on trust, i.e. unverified.
 */
async function attachPhone(db: Db, personId: number, phone: string, isPrimary: boolean, verified: boolean) {
    await db.phone
        .create({ data: { phone, personId, isPrimary, verifiedAt: verified ? new Date() : null } })
        .catch(() => { /* already on file — nothing to do */ });
}

async function attachEmail(db: Db, personId: number, email: string, isPrimary: boolean, verified: boolean) {
    await db.email
        .create({ data: { email, personId, isPrimary, verifiedAt: verified ? new Date() : null } })
        .catch(() => { /* already on file — nothing to do */ });
}

/**
 * Resolve the Person a verified identity belongs to, creating them when we have
 * never seen them before.
 *
 * Shared by passwordless onboarding and self-registration so both produce
 * exactly the same customer — Person + primary contact + cash-only Account
 * (creditLimit 0 until staff grant a limit) — instead of two near-identical
 * copies of the same transaction drifting apart.
 *
 * An existing customer is never renamed: staff own `Person.name`, and a
 * self-service form is not the place to overwrite it. We only top up a contact
 * row or an Account they are missing.
 */
export async function ensurePortalPerson(
    db: PrismaClient,
    identity: PortalContactIdentity,
    name: string,
    extraContact = ""
): Promise<{ id: number; name: string }> {
    // The optional second contact the onboarding form offers. Whether it is an
    // email or a mobile is read off the value itself, so the caller does not
    // have to tell us which channel was verified.
    const extra = extraContact.trim();
    const email =
        identity.emailNormalized ?? (extra.includes("@") ? normalizePortalEmail(extra) : null);
    const phone =
        identity.phoneNormalized ??
        (extra && !extra.includes("@") ? canonicalPhone(extra) : null);

    const phoneVerified = Boolean(identity.phoneNormalized);
    const emailVerified = Boolean(identity.emailNormalized);

    const existing = await findPortalPerson(db, identity);
    if (existing) {
        if (phone) await attachPhone(db, existing.id, phone, false, phoneVerified);
        if (email) await attachEmail(db, existing.id, email, false, emailVerified);
        const account = await db.account.findUnique({
            where: { personId: existing.id },
            select: { id: true },
        });
        if (!account) {
            await db.account.create({
                data: { personId: existing.id, name: existing.name, creditLimit: 0 },
            });
        }
        return existing;
    }

    const created = await db.$transaction(async (tx) => {
        const person = await tx.person.create({
            data: { name: name.trim() || email?.split("@")[0] || "Customer" },
        });
        // The proved channel is primary; the trusted extra one is neither
        // primary nor verified (an unverified row can never be primary).
        if (phone) {
            await tx.phone.create({
                data: { phone, personId: person.id, isPrimary: phoneVerified, verifiedAt: phoneVerified ? new Date() : null },
            });
        }
        if (email) {
            await tx.email.create({
                data: { email, personId: person.id, isPrimary: emailVerified, verifiedAt: emailVerified ? new Date() : null },
            });
        }
        await tx.account.create({
            data: { personId: person.id, name: person.name, creditLimit: 0 },
        });
        return person;
    });
    return { id: created.id, name: created.name };
}
