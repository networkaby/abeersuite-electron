// Account-group hierarchy walks — "which ledgers sit under this group?".
//
// Lifted out of outstandings.ts so both the outstanding reports and the
// bill-wise link engine can share one walk instead of keeping two copies (and
// so neither module has to import the other, which would be a cycle).

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/**
 * The client to read the group tree with. Defaults to the app's global one, so
 * every existing caller is unchanged.
 *
 * Passing one matters in two situations, and both were real bugs:
 *
 *   • INSIDE A TRANSACTION. `assertLinkPlan` and `assertLinkable` each hold a
 *     `tx` and used to ask for the party ledgers on the global client anyway —
 *     so the check read OUTSIDE the transaction it was guarding, and an account
 *     created in that same transaction was invisible to it.
 *   • FROM A SCRIPT. The global client is the app's, wired for counter mode and
 *     the local replica; a script that has opened its own connection to live
 *     cannot use it. `pnpm reconcile:bill-links --fix` died on exactly this —
 *     "The server does not support SSL connections", raised from here, several
 *     frames below a script that was talking to Supabase perfectly well. It is
 *     also why `repair-bill-links.ts` grew its own private copy of the walk.
 */
type GroupDb = Pick<Prisma.TransactionClient, "accountGroup" | "account">;

/**
 * Every active ledger id under `groupName`, following the group tree all the way
 * down (Sundry Debtors → its sub-groups → their sub-groups → …). Empty when the
 * group does not exist.
 */
export async function accountIdsUnderGroup(groupName: string, db: GroupDb = prisma): Promise<number[]> {
    const groups = await db.accountGroup.findMany({
        where: { isActive: true },
        select: { id: true, name: true, parentId: true },
    });
    const root = groups.find((g) => g.name === groupName);
    if (!root) return [];

    const included = new Set<number>([root.id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of groups) {
            if (g.parentId !== null && included.has(g.parentId) && !included.has(g.id)) {
                included.add(g.id);
                grew = true;
            }
        }
    }

    const accounts = await db.account.findMany({
        where: { isActive: true, groupId: { in: Array.from(included) } },
        select: { id: true },
    });
    return accounts.map((a) => a.id);
}

/**
 * The party ledgers — everything under Sundry Debtors OR Sundry Creditors.
 *
 * Bill-wise linking is only meaningful on a party ledger: two vouchers that both
 * touch Cash also have "opposite legs" on it, but netting a receipt against a
 * payment through the till would be nonsense. Restricting links to these ledgers
 * is what keeps the sign rule honest.
 */
export async function partyLedgerIds(db: GroupDb = prisma): Promise<Set<number>> {
    const [debtors, creditors] = await Promise.all([
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS, db),
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_CREDITORS, db),
    ]);
    return new Set([...debtors, ...creditors]);
}
