// Maps GroupType → which financial statement section the group belongs to.
// ASSET / LIABILITY → Balance Sheet ; INCOME / EXPENSE → Profit & Loss.

export type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
export type ReportSection = "BS_LIABILITY" | "BS_ASSET" | "PL_INCOME" | "PL_EXPENSE";

export function defaultNormalBalanceForGroupType(t: GroupTypeStr): "DEBIT" | "CREDIT" {
    if (t === "ASSET" || t === "EXPENSE") return "DEBIT";
    return "CREDIT";
}

/**
 * +1 when a ledger's nature matches its group's, −1 for a CONTRA ledger — one
 * whose nature opposes the group it sits in: Sales Returns (DEBIT) inside Sales
 * Accounts (CREDIT), Purchase Returns inside Purchase Accounts, Drawings inside
 * Capital Account, Cash Over inside Suspense A/c.
 *
 * `aggregateLedger` signs every balance against the ACCOUNT's own nature, so
 * anything rolling ledgers up into a GROUP total must apply this first —
 * otherwise a return ADDS to its group instead of reducing it, and a credit
 * lands on the debit side of the Balance Sheet.
 *
 * Exported because three places roll up and every one of them needs the same
 * rule: `buildGroupTree` (which feeds every report), the group-detail master
 * route, and the masters ledger tree. When only the first had it, Masters and
 * the Trial Balance printed different totals for the same group.
 */
export function groupSign(
    groupType: GroupTypeStr,
    normalBalance: "DEBIT" | "CREDIT" | null | undefined,
): 1 | -1 {
    const groupSide = defaultNormalBalanceForGroupType(groupType);
    return (normalBalance ?? groupSide) === groupSide ? 1 : -1;
}
