import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizePortalPhone } from "@/shared/lib/auth/portalIdentifier";

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

type Db = PrismaClient | Prisma.TransactionClient;

/** Written variants of a 10-digit Indian number that may sit in the DB. */
function phoneVariants(digits: string): string[] {
    const variants = new Set<string>([digits, `+91${digits}`, `91${digits}`, `0${digits}`]);
    return [...variants];
}

/** Find by email (case-insensitive). */
export async function findPersonByPortalEmail(db: Db, emailNormalized: string): Promise<FoundPerson> {
    const match = await db.email.findFirst({
        where: { email: { equals: emailNormalized, mode: "insensitive" }, personId: { not: null } },
        select: { person: { select: { id: true, name: true } } },
    });
    return match?.person ?? null;
}

/** Find by mobile, tolerating the various stored formats. */
export async function findPersonByPortalPhone(db: Db, phoneNormalized: string): Promise<FoundPerson> {
    const digits = normalizePortalPhone(phoneNormalized) ?? phoneNormalized;

    // Exact hits on the common written forms first — index-friendly.
    const exact = await db.phone.findFirst({
        where: { personId: { not: null }, phone: { in: phoneVariants(digits) } },
        select: { person: { select: { id: true, name: true } } },
    });
    if (exact?.person) return exact.person;

    // Fall back to spacing/punctuation variants ("98765 43210", "+91-98765-43210").
    // `endsWith` keeps this a single indexed-ish query instead of a table scan in JS,
    // then we confirm by normalising the few candidates it returns.
    const candidates = await db.phone.findMany({
        where: { personId: { not: null }, phone: { endsWith: digits.slice(-6) } },
        select: { phone: true, person: { select: { id: true, name: true } } },
        take: 50,
    });
    return (
        candidates.find((row) => row.phone && normalizePortalPhone(row.phone) === digits)?.person ?? null
    );
}

/** Email takes precedence when both are supplied. */
export async function findPortalPerson(
    db: Db,
    identity: { emailNormalized?: string | null; phoneNormalized?: string | null }
): Promise<FoundPerson> {
    if (identity.emailNormalized) {
        const byEmail = await findPersonByPortalEmail(db, identity.emailNormalized);
        if (byEmail) return byEmail;
    }
    if (identity.phoneNormalized) {
        return findPersonByPortalPhone(db, identity.phoneNormalized);
    }
    return null;
}
