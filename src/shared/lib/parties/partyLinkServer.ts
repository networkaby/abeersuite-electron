/**
 * Turn a voucher's stored party reference into a profile link, and optionally
 * the ledger Account it posts to.
 *
 * WHAT COSTS A QUERY AND WHAT DOES NOT. The voucher already records which table
 * its party lives in — `partyType` is written from the party picker, whose only
 * values are "customer" (Person) and "company" (Company) — so person-vs-company
 * is free, read off the row, and the profile link costs nothing at all.
 *
 * The stored id always leads to a live row: the converter and the merge tool
 * (`src/modules/customer/lib/convertParty.ts`) re-point every bill's
 * `partyType`/`partyId` at the surviving record and delete the old one in the
 * same transaction, so there is no forwarding note to follow. `partyJson`
 * still holds the name and address frozen at the time of the document.
 *
 * COST. One query, only when the caller needs the ledger Account id, for all
 * rows at once. Never a query per row.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { partyKindFromType, type PartyLinkKind, type PartyRef, type ResolvedPartyLink } from "./partyLink";

/** Anything that can run the queries — the client or a transaction client. */
type Db = Pick<PrismaClient, "account">;

/** Looks up the resolved link for a row. Rows with no party return `null`. */
export type PartyLinkResolver = {
    for(ref: PartyRef): ResolvedPartyLink | null;
};

const key = (kind: PartyLinkKind, id: number) => `${kind}:${id}`;

/**
 * Resolve each row's party to its profile link.
 *
 * Pass `withAccountId` only if you need the ledger account — it costs a query,
 * and most callers only want the profile link.
 */
export async function resolvePartyLinks(
    db: Db,
    refs: readonly PartyRef[],
    opts: { withAccountId?: boolean } = {},
): Promise<PartyLinkResolver> {
    let accountByEntity = new Map<string, number>();
    if (opts.withAccountId) {
        const personIds = new Set<number>();
        const companyIds = new Set<number>();
        for (const ref of refs) {
            const kind = partyKindFromType(ref.partyType);
            if (kind == null || ref.partyId == null) continue;
            (kind === "person" ? personIds : companyIds).add(ref.partyId);
        }
        if (personIds.size + companyIds.size > 0) {
            const accounts = await db.account.findMany({
                where: {
                    OR: [
                        { personId:  { in: [...personIds] } },
                        { companyId: { in: [...companyIds] } },
                    ],
                },
                select: { id: true, personId: true, companyId: true },
            });
            accountByEntity = new Map(accounts.flatMap((a) => [
                ...(a.personId  != null ? [[key("person",  a.personId),  a.id] as const] : []),
                ...(a.companyId != null ? [[key("company", a.companyId), a.id] as const] : []),
            ]));
        }
    }

    return {
        for(ref) {
            const kind = partyKindFromType(ref.partyType);
            if (kind == null || ref.partyId == null) return null;
            return {
                kind,
                entityId: ref.partyId,
                accountId: accountByEntity.get(key(kind, ref.partyId)) ?? null,
            };
        },
    };
}

/** The ledger Account a voucher's party posts to. `null` for a walk-in or an unknown party. */
export async function resolvePartyAccountId(db: Db, ref: PartyRef): Promise<number | null> {
    if (ref.partyId == null || partyKindFromType(ref.partyType) == null) return null;
    const links = await resolvePartyLinks(db, [ref], { withAccountId: true });
    return links.for(ref)?.accountId ?? null;
}
