// Offline-sync collision resolver — the ONLY piece of the offline-sync design
// built so far (see chat/PROJECT_BRAIN for the rest). Two counters offline at
// once can each create a Person for the same real customer. Phone/Email are
// globally @unique (see base.prisma), so pushing the second one to live would
// fail outright.
//
// We don't merge the two Persons — an offline sale never carries credit or
// history worth preserving (cash/card only, brand-new customer). Instead the
// loser's Person/Account is simply never created on live. Because the
// collision was found BY phone/email, we already know exactly which live
// Person it really is — so the voucher is repointed straight to THAT Person's
// real Account and pushed correctly, no manual step needed. Walk-in is only
// the fallback for the (schema-shouldn't-allow-it) case where the matched
// Person somehow has no Account row.
//
// The captured name/phone is preserved regardless — the voucher's own
// partyJson snapshot (see partySnapshot.ts) keeps it independent of accountId,
// so even a genuine walk-in fallback still shows who the cashier said it was.

import type { PrismaClient } from "@/generated/prisma/client";
import { ACCOUNT_LEDGERS } from "@/shared/lib/constants/accounting";

let walkInAccountIdCache: number | null = null;

/**
 * The Walk-in Cash Customer account id on live. Cached for the process
 * lifetime — it's a static reference row, never re-seeded.
 */
export async function getWalkInAccountId(prismaLive: PrismaClient): Promise<number> {
    if (walkInAccountIdCache != null) return walkInAccountIdCache;
    // Matched on the seeded NAME — `Account.code` was retired (see
    // 20260917090000_product_opening_branch). Name is exact, never fuzzy, and the
    // identity columns are pinned null so a real customer who happens to be
    // called this can never be picked up instead.
    const account = await prismaLive.account.findFirst({
        where: { name: ACCOUNT_LEDGERS.WALK_IN, personId: null, companyId: null },
        select: { id: true },
    });
    if (!account) {
        throw new Error(`Walk-in account ("${ACCOUNT_LEDGERS.WALK_IN}") not seeded on live.`);
    }
    walkInAccountIdCache = account.id;
    return account.id;
}

/**
 * Does a locally-created Person collide with one already on live? Returns the
 * live Person's Account id directly (every Person gets exactly one Account —
 * see accounts.prisma), since that's what a colliding voucher needs to push
 * against.
 *
 * Checked on ANY overlap across all of the person's phones/emails (a person
 * can hold several of each — see base.prisma) — not just a single "primary"
 * field, since staff may have captured different numbers at each counter.
 */
export async function findLivePersonCollision(
    prismaLive: PrismaClient,
    candidate: { phones: string[]; emails: string[] },
): Promise<{ personId: number; accountId: number | null } | null> {
    const phones = candidate.phones.filter(Boolean);
    const emails = candidate.emails.filter(Boolean);
    if (phones.length === 0 && emails.length === 0) return null;

    const [phoneHit, emailHit] = await Promise.all([
        phones.length
            ? prismaLive.phone.findFirst({
                  where: { phone: { in: phones }, personId: { not: null } },
                  select: { person: { select: { id: true, account: { select: { id: true } } } } },
              })
            : null,
        emails.length
            ? prismaLive.email.findFirst({
                  where: { email: { in: emails }, personId: { not: null } },
                  select: { person: { select: { id: true, account: { select: { id: true } } } } },
              })
            : null,
    ]);

    const hit = phoneHit?.person ?? emailHit?.person;
    return hit ? { personId: hit.id, accountId: hit.account?.id ?? null } : null;
}

/**
 * Resolve which `accountId` a locally-created voucher should push with.
 *
 * - No collision → `{ collided: false }`, caller proceeds to create the
 *   Person/Account on live and push the voucher against it as normal.
 * - Collision → `{ collided: true, accountId }`, the MATCHED live customer's
 *   own Account id (falls back to Walk-in only if that Person somehow has no
 *   Account — should not happen per schema). Caller must NOT create the local
 *   Person/Account on live, and must rewrite the voucher's `accountId` to this
 *   value before pushing it.
 */
export async function resolveOfflinePersonPush(
    prismaLive: PrismaClient,
    candidate: { phones: string[]; emails: string[] },
): Promise<{ collided: false } | { collided: true; accountId: number }> {
    const collision = await findLivePersonCollision(prismaLive, candidate);
    if (!collision) return { collided: false };
    const accountId = collision.accountId ?? (await getWalkInAccountId(prismaLive));
    return { collided: true, accountId };
}

/**
 * Find the live Account for a person by a single phone number — the lookup a
 * "reassign this walk-in voucher to its real customer" action needs, using the
 * phone preserved in the voucher's own `partyJson` snapshot (see
 * partySnapshot.ts / readPartyPhone). Returns null when no party on live holds
 * that phone (nothing to reassign to yet). Kept as a standalone helper for the
 * rare true-walk-in-fallback case above, and for any manual re-check later.
 */
export async function findAccountIdByPhone(
    prismaLive: PrismaClient,
    phone: string,
): Promise<number | null> {
    const trimmed = phone.trim();
    if (!trimmed) return null;
    const hit = await prismaLive.phone.findUnique({
        where: { phone: trimmed },
        select: { person: { select: { account: { select: { id: true } } } } },
    });
    return hit?.person?.account?.id ?? null;
}
