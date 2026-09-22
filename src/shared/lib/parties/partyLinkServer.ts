/**
 * Turn stored voucher `partyId`s into links that still open, including after a
 * party has been converted between a Person and a Company.
 *
 * WHY THIS IS NOT A PLAIN LOOKUP. A conversion (see
 * `src/modules/customer/lib/convertParty.ts`) creates the new record, moves the
 * ledger Account / phones / emails onto it, and then soft-deletes the old one
 * leaving a tombstone — `Person.convertedToCompanyId` or
 * `Company.convertedToPersonId`. It deliberately does NOT rewrite history: old
 * vouchers keep the party id they were raised with, because a document must
 * keep saying who it was actually raised against. The cost of that is that the
 * stored id stops resolving on its own, and the reader has to follow the
 * tombstone. Every screen that skipped this step showed a dead party link.
 *
 * COST. Bounded — at most four queries for a whole page of rows, never one per
 * row, and the last three run only when something actually failed to resolve
 * (i.e. never, on a database with no conversions in it).
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { PartyLinkKind, ResolvedPartyLink } from "./partyLink";

/** Anything that can run the queries — the client or a transaction client. */
type Db = Pick<PrismaClient, "account" | "person" | "company">;

/**
 * Resolve each party id to the live record behind it.
 *
 * Ids that resolve to nothing at all — a party since hard-deleted, or an
 * "account"-type voucher whose partyId is not a party — are simply absent from
 * the map, and the caller renders them as plain text.
 */
export async function resolvePartyLinks(
    db: Db,
    partyIds: readonly (number | null | undefined)[],
): Promise<Map<number, ResolvedPartyLink>> {
    const ids = [...new Set(partyIds.filter((id): id is number => id != null))];
    const resolved = new Map<number, ResolvedPartyLink>();
    if (ids.length === 0) return resolved;

    // Pass one: the ids that still point at a live party. An Account row is the
    // proof of life — it is what carries the party's money, and a conversion
    // moves it rather than duplicating it.
    const accounts = await db.account.findMany({
        where: { OR: [{ personId: { in: ids } }, { companyId: { in: ids } }] },
        select: { id: true, personId: true, companyId: true },
    });
    for (const a of accounts) {
        // Person wins when both could match. Person.id and Company.id are
        // independent sequences, so the same number can name one of each; the
        // collision is rare and the voucher's partyType cannot settle it, so we
        // pick one side deterministically rather than guess per row.
        if (a.personId != null) {
            resolved.set(a.personId, { kind: "person", entityId: a.personId, accountId: a.id });
        }
        if (a.companyId != null && !resolved.has(a.companyId)) {
            resolved.set(a.companyId, { kind: "company", entityId: a.companyId, accountId: a.id });
        }
    }

    const unresolved = ids.filter((id) => !resolved.has(id));
    if (unresolved.length === 0) return resolved;

    // Pass two: follow the conversion tombstone on whatever is left.
    const [convertedPersons, convertedCompanies] = await Promise.all([
        db.person.findMany({
            where: { id: { in: unresolved }, convertedToCompanyId: { not: null } },
            select: { id: true, convertedToCompanyId: true },
        }),
        db.company.findMany({
            where: { id: { in: unresolved }, convertedToPersonId: { not: null } },
            select: { id: true, convertedToPersonId: true },
        }),
    ]);
    const targetCompanyIds = convertedPersons.map((p) => p.convertedToCompanyId!);
    const targetPersonIds  = convertedCompanies.map((c) => c.convertedToPersonId!);
    if (targetCompanyIds.length === 0 && targetPersonIds.length === 0) return resolved;

    // Pass three: the moved Account, so the row can still reach the ledger.
    const targetAccounts = await db.account.findMany({
        where: {
            OR: [
                { companyId: { in: targetCompanyIds } },
                { personId:  { in: targetPersonIds } },
            ],
        },
        select: { id: true, personId: true, companyId: true },
    });
    const accountByCompanyId = new Map(
        targetAccounts.filter((a) => a.companyId != null).map((a) => [a.companyId!, a.id]),
    );
    const accountByPersonId = new Map(
        targetAccounts.filter((a) => a.personId != null).map((a) => [a.personId!, a.id]),
    );

    const link = (
        sourceId: number, kind: PartyLinkKind, entityId: number, accountId: number | undefined,
    ) => {
        // No Account on the target means the conversion left nothing to open —
        // leave the id unresolved rather than link to a shell record.
        if (accountId == null) return;
        resolved.set(sourceId, { kind, entityId, accountId });
    };
    for (const p of convertedPersons) {
        const target = p.convertedToCompanyId!;
        link(p.id, "company", target, accountByCompanyId.get(target));
    }
    for (const c of convertedCompanies) {
        const target = c.convertedToPersonId!;
        link(c.id, "person", target, accountByPersonId.get(target));
    }
    return resolved;
}
