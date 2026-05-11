import type { GroupType } from "@/generated/prisma/client";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

/**
 * Inventory rule
 * --------------
 * Inventory items only attach to lines posted against a ledger under the
 * **Sales Accounts** or **Purchase Accounts** group — *any* ledger under
 * either group qualifies (Sales A/c, Parts Revenue, Shop Sales Revenue,
 * Sales Returns, Purchase A/c, Purchase Returns, …). All other vouchers
 * move money / liability only, not stock.
 *
 * Stock direction follows the **posting side** of the inventory line, not
 * the ledger's identity. That is what makes reversals natural — the same
 * ledger can move stock either way depending on whether it's posted on
 * Dr or Cr:
 *
 *   • Inventory line posted on **DEBIT** → stock IN  (qty / value rises)
 *   • Inventory line posted on **CREDIT** → stock OUT (qty / value falls)
 *
 * So a Sales A/c on Cr is a sale (stock OUT); a Sales A/c on Dr reverses
 * it (stock IN). A Purchase A/c on Dr is a purchase (stock IN); on Cr it
 * reverses (stock OUT). Sales Returns / Purchase Returns ledgers behave
 * the same way — the side is the source of truth.
 *
 * Posting code: `journal-vouchers/route.ts` and `postInvVoucher.ts` both
 * read `line.type` (DEBIT / CREDIT) and set `inQty` / `outQty` on the
 * stock ledger accordingly.
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
