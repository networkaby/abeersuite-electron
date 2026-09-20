// Wire shapes of HR → Payroll. Dates are ISO yyyy-mm-dd; money is paise.

import type { SalaryLine } from "./salaryLines";

export type PayrollRunStatus = "DRAFT" | "POSTED" | "CANCELLED";

/** One person on a run — their salary for that month, frozen at generation. */
export interface PayrollLineDto {
    id: number;
    userId: number;
    staffName: string;
    staffCode: string | null;
    /** The revision the amounts came from; null when the person has none. */
    effectiveFrom: string | null;
    lines: SalaryLine[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    ledger: { id: number; name: string } | null;
    expenseAccount: { id: number; name: string } | null;
    included: boolean;
    /** Why the generator could not pay them. Null on a normal line. */
    skipReason: string | null;
}

/** A row of the runs list — everything the list shows, no join needed. */
export interface PayrollRunRow {
    id: number;
    /** First day of the month paid, e.g. "2026-09-01". */
    periodMonth: string;
    postingDate: string;
    status: PayrollRunStatus;
    voucherId: number | null;
    voucherRef: string | null;
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    headcount: number;
    note: string | null;
    createdAt: string;
    postedAt: string | null;
    createdBy: string | null;
    postedBy: string | null;
}

/** The run workspace's payload. */
export interface PayrollRunDetail extends PayrollRunRow {
    lines: PayrollLineDto[];
}

/** What a month would look like, before any run exists. Nothing is written. */
export interface PayrollPreview {
    periodMonth: string;
    postingDate: string;
    /** The run already generated for this month, if there is one. */
    existingRunId: number | null;
    existingStatus: PayrollRunStatus | null;
    lines: PayrollLineDto[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    headcount: number;
    skippedCount: number;
}

/** "2026-09-01" → "September 2026". */
export function formatPeriodMonth(iso: string): string {
    const [y, m] = iso.split("-");
    const names = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    return `${names[Number(m) - 1] ?? m} ${y}`;
}

export const PAYROLL_STATUS_LABELS: Record<PayrollRunStatus, string> = {
    DRAFT:     "Draft",
    POSTED:    "Posted",
    CANCELLED: "Cancelled",
};
