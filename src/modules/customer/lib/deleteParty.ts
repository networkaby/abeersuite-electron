// Delete (or safely deactivate) a Person/Company party.
//
// Rule: a party with no posted GL activity AND no ledger balance (including
// any master opening balance — a party can carry one with zero GL lines
// posted yet) has nothing worth preserving, so it's hard-deleted outright.
// Once money has moved — or is sitting as an opening balance — the row is
// kept forever (isActive: false) so vouchers/reports never dangle a
// reference. Devices always block outright — repair/ticket history on a
// device must never be silently erased.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { closingForAccounts } from "@/modules/accountancy/lib/aggregateLedger";

export type DeletePartyResult =
    | { outcome: "deleted" }
    | { outcome: "deactivated" }
    | { outcome: "blocked"; reason: string };

async function hasClearLedger(accountId: number): Promise<boolean> {
    const lineCount = await prisma.voucherGlLine.count({ where: { accountId } });
    if (lineCount > 0) return false;
    // Summed from the ledger, not from `Account.balance`. This decides whether a
    // party row is erased for good, so it must not be able to read zero off a
    // drifted cache while the books still carry an opening balance for them.
    const closing = (await closingForAccounts(null, [accountId])).get(accountId) ?? 0;
    return closing === 0;
}

export async function deleteOrDeactivatePerson(id: number): Promise<DeletePartyResult> {
    const hasDevices = await prisma.device.count({ where: { account: { personId: id } } });
    if (hasDevices > 0) {
        return { outcome: "blocked", reason: "Cannot delete a person with devices" };
    }

    const account = await prisma.account.findUnique({ where: { personId: id }, select: { id: true } });
    const clear = account ? await hasClearLedger(account.id) : true;

    if (!clear) {
        await prisma.person.update({ where: { id }, data: { isActive: false } });
        return { outcome: "deactivated" };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.personCompany.deleteMany({ where: { personId: id } });
            if (account) await tx.account.delete({ where: { id: account.id } });
            await tx.person.delete({ where: { id } });
        });
        return { outcome: "deleted" };
    } catch (e) {
        // Referenced by something else with no cascade (a Deal/Order/Help ticket,
        // portal credential, social profile/connection, merge/convert back-link) —
        // fall back to the same safe deactivation as the "has transactions" path.
        if (e && typeof e === "object" && "code" in e && e.code === "P2003") {
            await prisma.person.update({ where: { id }, data: { isActive: false } });
            return { outcome: "deactivated" };
        }
        throw e;
    }
}

export async function deleteOrDeactivateCompany(id: number): Promise<DeletePartyResult> {
    const hasDevices = await prisma.device.count({ where: { account: { companyId: id } } });
    if (hasDevices > 0) {
        return { outcome: "blocked", reason: "Cannot delete a company with devices" };
    }

    const account = await prisma.account.findUnique({ where: { companyId: id }, select: { id: true } });
    const clear = account ? await hasClearLedger(account.id) : true;

    if (!clear) {
        await prisma.company.update({ where: { id }, data: { isActive: false } });
        return { outcome: "deactivated" };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.personCompany.deleteMany({ where: { companyId: id } });
            if (account) await tx.account.delete({ where: { id: account.id } });
            await tx.company.delete({ where: { id } });
        });
        return { outcome: "deleted" };
    } catch (e) {
        if (e && typeof e === "object" && "code" in e && e.code === "P2003") {
            await prisma.company.update({ where: { id }, data: { isActive: false } });
            return { outcome: "deactivated" };
        }
        throw e;
    }
}
