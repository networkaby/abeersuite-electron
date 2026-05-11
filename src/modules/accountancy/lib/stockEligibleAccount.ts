import type { GroupType } from "@/generated/prisma/client";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/**
 * Inventory rule
 * --------------
 * Inventory items only attach to lines posted against a **Sales Accounts** or
 * **Purchase Accounts** ledger. In any other voucher the value flows through
 * ledgers, not stock. Concretely:
 *
 *   • Sales Accounts group  → Sales A/c, Parts Revenue, Shop Sales Revenue,
 *                             Sales Returns — Sale decreases inventory;
 *                             Sales Return increases it.
 *   • Purchase Accounts grp → Purchase A/c, Purchase Returns — Purchase
 *                             increases inventory; Purchase Return decreases.
 *
 * Exceptions (vouchers that move stock without a sales / purchase ledger):
 *   • Stock Journal — internal stock transfers / consumption / production.
 *   • Physical Stock — periodic count adjustments.
 *
 * The voucher's stock side balances against the Stock-in-Hand asset ledger
 * via the trading-account stock adjustment computed in
 * `tradingStockAdjustment.ts`. See docs/modules/accountancy.md
 * "Inventory–ledger coupling" for the full policy.
 */
const STOCK_ELIGIBLE_GROUP_NAMES: string[] = [
    ACCOUNT_GROUPS.SALES_ACCOUNTS,
    ACCOUNT_GROUPS.PURCHASE_ACCOUNTS,
];

/** Kept for any consumer that still wants the broad income/expense check.
 *  New code should prefer `isStockEligibleAccount` (group-name match). */
export const STOCK_ELIGIBLE_GROUP_TYPES: GroupType[] = ["INCOME", "EXPENSE"];

export function isStockEligibleAccount(
    a: { group?: { name?: string | null; type?: GroupType | null } | null } | null | undefined,
): boolean {
    const name = a?.group?.name ?? null;
    return name != null && STOCK_ELIGIBLE_GROUP_NAMES.includes(name);
}
