import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ACCOUNT_GROUPS, ACCOUNT_LEDGERS } from "@/shared/lib/constants/accounting";

/**
 * The staff member's own ledger — created once, inside the transaction that
 * first saves their HR profile, the same way a Person gets an Account on creation.
 *
 * Group: "Salary Payable" (LIABILITY, under Current Liabilities). The seed
 * creates the group on a fresh install; this find-or-create is for a database
 * that took the migration through a Vercel deploy and never re-ran the seed —
 * Vercel runs migrations, not seeds (the same reasoning as ensureVoucherSeries).
 */
export async function ensureSalaryPayableGroup(tx: Prisma.TransactionClient): Promise<number> {
    const existing = await tx.accountGroup.findFirst({
        where: { name: ACCOUNT_GROUPS.SALARY_PAYABLE },
        select: { id: true },
    });
    if (existing) return existing.id;

    const parent = await tx.accountGroup.findFirst({
        where: { name: "Current Liabilities" },
        select: { id: true },
    });
    const created = await tx.accountGroup.create({
        data: {
            name: ACCOUNT_GROUPS.SALARY_PAYABLE,
            type: "LIABILITY",
            sortOrder: 25,
            parentId: parent?.id ?? null,
        },
        select: { id: true },
    });
    return created.id;
}

/**
 * Create the ledger for one staff member and return its id.
 *
 * Named after the person. A ledger name is not unique in the chart, but two
 * "Rakesh Biswas" rows — one a customer, one the staff member — would be the
 * same words in every picker, so on a clash the staff ledger says so.
 */
export async function createStaffLedger(
    tx: Prisma.TransactionClient,
    user: { id: number; name: string },
): Promise<number> {
    const groupId = await ensureSalaryPayableGroup(tx);
    const clash = await tx.account.findFirst({
        where: { name: { equals: user.name, mode: "insensitive" } },
        select: { id: true },
    });
    const account = await tx.account.create({
        data: {
            name: clash ? `${user.name} (Staff)` : user.name,
            groupId,
            normalBalance: "CREDIT",
            description: "Staff ledger — salary accrues here, advances and payments go out of it.",
        },
        select: { id: true },
    });
    return account.id;
}

/**
 * The ONE ledger a payroll run books its salary expense against.
 *
 * Owner, 2026-09-20: "exp account is common to all". There is no per-person
 * expense account — the P&L answers "what did labour cost the business", and
 * three hundred staff must not become three hundred lines in it. The person's
 * own account is a LIABILITY (createStaffLedger above); this is the Dr side.
 *
 * Found by exact name, which ACCOUNT_LEDGERS documents as safe. Created under
 * Indirect Expenses if it is missing, for the same reason the Salary Payable
 * group is: Vercel runs migrations, not seeds, so a database that took the
 * schema through a deploy may never have seen the chart of accounts.
 */
export async function ensureSalaryExpenseAccount(tx: Prisma.TransactionClient): Promise<number> {
    const existing = await tx.account.findFirst({
        where: { name: ACCOUNT_LEDGERS.SALARY_WAGES },
        select: { id: true },
    });
    if (existing) return existing.id;

    const group = await tx.accountGroup.findFirst({
        where: { name: "Indirect Expenses" },
        select: { id: true },
    });
    if (!group) throw new Error('No "Indirect Expenses" group — seed the chart of accounts first');

    const created = await tx.account.create({
        data: {
            name: ACCOUNT_LEDGERS.SALARY_WAGES,
            groupId: group.id,
            normalBalance: "DEBIT",
            description: "Salary and wages for the whole shop — the Dr side of every payroll run.",
        },
        select: { id: true },
    });
    return created.id;
}
