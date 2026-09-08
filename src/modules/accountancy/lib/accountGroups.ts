// Account-group hierarchy walks — "which ledgers sit under this group?".
//
// Lifted out of outstandings.ts so both the outstanding reports and the
// bill-wise link engine can share one walk instead of keeping two copies (and
// so neither module has to import the other, which would be a cycle).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/**
 * Every active ledger id under `groupName`, following the group tree all the way
 * down (Sundry Debtors → its sub-groups → their sub-groups → …). Empty when the
 * group does not exist.
 */
export async function accountIdsUnderGroup(groupName: string): Promise<number[]> {
    const groups = await prisma.accountGroup.findMany({
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

    const accounts = await prisma.account.findMany({
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
export async function partyLedgerIds(): Promise<Set<number>> {
    const [debtors, creditors] = await Promise.all([
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_DEBTORS),
        accountIdsUnderGroup(ACCOUNT_GROUPS.SUNDRY_CREDITORS),
    ]);
    return new Set([...debtors, ...creditors]);
}
