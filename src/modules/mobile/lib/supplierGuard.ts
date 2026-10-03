import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { seesSuppliers } from "./mobileScreens";

/** Is this ledger a Sundry Creditor this person may not see? The party screen, its
 *  APIs and the Pay / Receive form answer "not found" then — the phone app hides
 *  suppliers behind "Show suppliers (creditors)" exactly as the office does. */
export async function supplierHidden(accountId: number, permissions: readonly string[]): Promise<boolean> {
    if (seesSuppliers(permissions)) return false;
    const hit = await prisma.account.findFirst({
        where: { id: accountId, group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } },
        select: { id: true },
    });
    return hit != null;
}

/** The ids among `accountIds` that are Sundry Creditors — one read for a page. */
export async function supplierAccountIds(accountIds: number[]): Promise<Set<number>> {
    if (accountIds.length === 0) return new Set();
    const rows = await prisma.account.findMany({
        where: { id: { in: accountIds }, group: { is: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS } } },
        select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
}
