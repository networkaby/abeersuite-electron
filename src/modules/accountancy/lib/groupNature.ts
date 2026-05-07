// Maps GroupType → which financial statement section the group belongs to.
// ASSET / LIABILITY → Balance Sheet ; INCOME / EXPENSE → Profit & Loss.

export type GroupTypeStr = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
export type ReportSection = "BS_LIABILITY" | "BS_ASSET" | "PL_INCOME" | "PL_EXPENSE";

export const BS_TYPES: GroupTypeStr[] = ["ASSET", "LIABILITY"];
export const PL_TYPES: GroupTypeStr[] = ["INCOME", "EXPENSE"];

export function groupTypeToSection(t: GroupTypeStr): ReportSection {
    if (t === "ASSET")     return "BS_ASSET";
    if (t === "LIABILITY") return "BS_LIABILITY";
    if (t === "INCOME")    return "PL_INCOME";
    return "PL_EXPENSE";
}

export function defaultNormalBalanceForGroupType(t: GroupTypeStr): "DEBIT" | "CREDIT" {
    if (t === "ASSET" || t === "EXPENSE") return "DEBIT";
    return "CREDIT";
}
