/**
 * Keep a voucher's party link pointing at a record that still opens, after the
 * party has been converted between a Person and a Company, or merged into
 * another party.
 *
 * WHAT COSTS A QUERY AND WHAT DOES NOT. The voucher already records which table
 * its party lives in — `partyType` is written from the party picker, whose only
 * values are "customer" (Person) and "company" (Company) — so person-vs-company
 * is free, read off the row. The one thing the row cannot know is whether that
 * record is still the live one.
 *
 * It may not be. Both the converter (`src/modules/customer/lib/convertParty.ts`)
 * and the merge tool move the ledger Account / phones / emails onto the surviving
 * record, soft-delete the old one, and leave a forwarding note on it:
 *
 *   convertedToCompanyId / convertedToPersonId   a conversion, crosses tables
 *   mergedIntoPersonId   / mergedIntoCompanyId   a merge, stays in one table
 *
 * Neither rewrites history: a document must keep saying who it was actually
 * raised against, and `partyJson` holds the name and address frozen at that
 * moment. The cost is that the stored id stops leading anywhere, and the reader
 * has to follow the note. Every screen that skipped that step showed a party
 * that would not open.
 *
 * COST. One query per table actually referenced, asking only "which of these
 * ids were forwarded away" — on most pages, none, and the walk stops there. A
 * further round only if a forwarding target was ITSELF forwarded (merge a
 * party, then convert the survivor); the walk is capped so a cycle cannot spin.
 * A second query at the end only when the caller needs the ledger Account id.
 * Never a query per row.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { partyKindFromType, type PartyLinkKind, type PartyRef, type ResolvedPartyLink } from "./partyLink";

/** Anything that can run the queries — the client or a transaction client. */
type Db = Pick<PrismaClient, "account" | "person" | "company">;

/** Looks up the resolved link for a row. Rows with no party return `null`. */
export type PartyLinkResolver = {
    for(ref: PartyRef): ResolvedPartyLink | null;
};

type Target = { kind: PartyLinkKind; entityId: number };

const key = (kind: PartyLinkKind, id: number) => `${kind}:${id}`;

/** Chains longer than this are treated as unresolvable rather than walked forever. */
const MAX_HOPS = 4;

/**
 * Resolve each row's party to the record that is live today.
 *
 * Pass `withAccountId` only if you need the ledger account — it costs an extra
 * query, and most callers only want the profile link.
 */
export async function resolvePartyLinks(
    db: Db,
    refs: readonly PartyRef[],
    opts: { withAccountId?: boolean } = {},
): Promise<PartyLinkResolver> {
    // Where each row points before any forwarding is followed.
    const stored = new Map<string, Target>();
    for (const ref of refs) {
        const kind = partyKindFromType(ref.partyType);
        if (kind == null || ref.partyId == null) continue;
        stored.set(key(kind, ref.partyId), { kind, entityId: ref.partyId });
    }
    if (stored.size === 0) return { for: () => null };

    // One forwarding hop for a set of targets: which are dead, and where to.
    const hop = async (targets: Target[]): Promise<Map<string, Target>> => {
        const personIds  = targets.filter((t) => t.kind === "person").map((t) => t.entityId);
        const companyIds = targets.filter((t) => t.kind === "company").map((t) => t.entityId);
        const [persons, companies] = await Promise.all([
            personIds.length === 0 ? [] : db.person.findMany({
                where: {
                    id: { in: personIds },
                    OR: [{ convertedToCompanyId: { not: null } }, { mergedIntoPersonId: { not: null } }],
                },
                select: { id: true, convertedToCompanyId: true, mergedIntoPersonId: true },
            }),
            companyIds.length === 0 ? [] : db.company.findMany({
                where: {
                    id: { in: companyIds },
                    OR: [{ convertedToPersonId: { not: null } }, { mergedIntoCompanyId: { not: null } }],
                },
                select: { id: true, convertedToPersonId: true, mergedIntoCompanyId: true },
            }),
        ]);
        const out = new Map<string, Target>();
        for (const p of persons) {
            // A conversion crosses tables; a merge stays in this one.
            const to: Target = p.convertedToCompanyId != null
                ? { kind: "company", entityId: p.convertedToCompanyId }
                : { kind: "person",  entityId: p.mergedIntoPersonId! };
            out.set(key("person", p.id), to);
        }
        for (const c of companies) {
            const to: Target = c.convertedToPersonId != null
                ? { kind: "person",  entityId: c.convertedToPersonId }
                : { kind: "company", entityId: c.mergedIntoCompanyId! };
            out.set(key("company", c.id), to);
        }
        return out;
    };

    // Walk the forwarding notes. Round one asks about the stored ids; a further
    // round only happens if that round actually forwarded something somewhere
    // we have not already asked about, so an unconverted book stops after one.
    const forwarded = new Map<string, Target>();
    const asked = new Set<string>();
    let frontier = [...stored.values()];
    for (let i = 0; i < MAX_HOPS && frontier.length > 0; i++) {
        for (const t of frontier) asked.add(key(t.kind, t.entityId));
        const found = await hop(frontier);
        if (found.size === 0) break;
        for (const [from, to] of found) forwarded.set(from, to);
        frontier = [...found.values()].filter((t) => !asked.has(key(t.kind, t.entityId)));
    }

    /** Follow a stored id to where it lives now. `null` if the chain is broken. */
    const live = (start: Target): Target | null => {
        let at = start;
        for (let i = 0; i <= MAX_HOPS; i++) {
            const next = forwarded.get(key(at.kind, at.entityId));
            if (next == null) return at;
            at = next;
        }
        return null;   // longer than we walked — better no link than a wrong one
    };

    let accountByEntity = new Map<string, number>();
    if (opts.withAccountId) {
        const targets = [...stored.values()].map(live).filter((t): t is Target => t != null);
        const accounts = await db.account.findMany({
            where: {
                OR: [
                    { personId:  { in: targets.filter((t) => t.kind === "person").map((t) => t.entityId) } },
                    { companyId: { in: targets.filter((t) => t.kind === "company").map((t) => t.entityId) } },
                ],
            },
            select: { id: true, personId: true, companyId: true },
        });
        accountByEntity = new Map(accounts.flatMap((a) => [
            ...(a.personId  != null ? [[key("person",  a.personId),  a.id] as const] : []),
            ...(a.companyId != null ? [[key("company", a.companyId), a.id] as const] : []),
        ]));
    }

    return {
        for(ref) {
            const kind = partyKindFromType(ref.partyType);
            if (kind == null || ref.partyId == null) return null;
            const target = live({ kind, entityId: ref.partyId });
            if (target == null) return null;
            return {
                ...target,
                accountId: accountByEntity.get(key(target.kind, target.entityId)) ?? null,
            };
        },
    };
}

/**
 * The ledger Account a voucher's party posts to TODAY.
 *
 * A save must not look the account up by the stored id alone: after a
 * conversion or merge that id names a soft-deleted row with no Account, and
 * the naive lookup would write a blank party ledger onto the spine — the
 * voucher would vanish from the party's statement and outstandings. This
 * follows the forwarding note first, so an old bill re-saved from the editor
 * keeps posting to the survivor.
 */
export async function resolvePartyAccountId(db: Db, ref: PartyRef): Promise<number | null> {
    if (ref.partyId == null || partyKindFromType(ref.partyType) == null) return null;
    const links = await resolvePartyLinks(db, [ref], { withAccountId: true });
    return links.for(ref)?.accountId ?? null;
}
