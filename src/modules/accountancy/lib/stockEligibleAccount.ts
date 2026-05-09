import type { GroupType } from "@/generated/prisma/client";

// Tally convention: only INCOME (Sales) and EXPENSE (Purchase, COGS, Goods
// Damaged, Direct/Indirect Expenses) ledgers can carry inventory items in a
// journal voucher.
//
// ASSET (Cash, Bank, AR, Stock-in-Hand) and LIABILITY (AP, Loans, Capital)
// ledgers are pure money/liability ledgers — they hold value, not stock.
// Direct stock-value adjustments use Stock Journal / Physical Stock vouchers
// in the inventory module, not journal vouchers.
export const STOCK_ELIGIBLE_GROUP_TYPES: GroupType[] = ["INCOME", "EXPENSE"];

export function isStockEligibleAccount(
    a: { group?: { type?: GroupType | null } | null } | null | undefined,
): boolean {
    const t = a?.group?.type;
    return t === "INCOME" || t === "EXPENSE";
}
