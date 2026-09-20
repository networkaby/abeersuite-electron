// Wire shapes of HR → Payroll. Dates are ISO yyyy-mm-dd; money is paise.
//
// A run pays a date RANGE — "from the last payroll to till day" — not a
// calendar month, so every shape here carries periodFrom / periodTo and the
// day counts the proportion was worked out from.

import type { SalaryLine } from "./salaryLines";

export type PayrollRunStatus = "DRAFT" | "POSTED" | "CANCELLED";

/** One person on a run — their pay for that period, frozen at generation. */
export interface PayrollLineDto {
    id: number;
    userId: number;
    staffName: string;
    staffCode: string | null;
    /** The latest revision behind the figure; null when they have none. */
    effectiveFrom: string | null;
    /** The pay heads, already proportioned to the period. */
    lines: SalaryLine[];
    /** Their full monthly net, for "₹16,000 a month". 0 on a stored run. */
    monthlyNetPaise: number;
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    /** Days of the period they were employed, and the period's own length. */
    paidDays: number;
    periodDays: number;
    ledger: { id: number; name: string } | null;
    included: boolean;
    /** Why the generator could not pay them. Null on a normal line. */
    skipReason: string | null;
}

/** A row of the history list — everything it shows, no join needed. */
export interface PayrollRunRow {
    id: number;
    periodFrom: string;
    periodTo: string;
    postingDate: string;
    status: PayrollRunStatus;
    voucherId: number | null;
    voucherRef: string | null;
    /** The one ledger the whole run is booked against. */
    expenseAccount: { id: number; name: string } | null;
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

/**
 * One salary slip, as a person sees it on their own profile. Every figure is
 * read straight off the run's frozen line — never recomputed — so a slip says
 * the same thing in ten years as it did the day it was posted.
 */
export interface PayslipDto {
    id: number;
    runId: number;
    periodFrom: string;
    periodTo: string;
    postingDate: string;
    postedAt: string | null;
    voucherId: number | null;
    voucherRef: string | null;
    lines: SalaryLine[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    paidDays: number;
    periodDays: number;
    /** The salary revision the figures came from. */
    effectiveFrom: string | null;
}

/** The run workspace's payload. */
export interface PayrollRunDetail extends PayrollRunRow {
    lines: PayrollLineDto[];
}

/** What a period would pay, before any run exists. Nothing is written. */
export interface PayrollPreview {
    periodFrom: string;
    periodTo: string;
    /** Where the suggested start came from, so the screen can explain itself. */
    startedFrom: "after-last-run" | "first-joining" | "given";
    /** A run already covering part of this period — generation is refused. */
    overlapRunId: number | null;
    overlapLabel: string | null;
    lines: PayrollLineDto[];
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    headcount: number;
    skippedCount: number;
}

/** "2026-09-01".."2026-09-20" → "1–20 Sep 2026", collapsing what is shared. */
export function formatPeriod(fromIso: string, toIso: string): string {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [fy, fm, fd] = fromIso.split("-");
    const [ty, tm, td] = toIso.split("-");
    const f = { y: fy, m: MONTHS[Number(fm) - 1] ?? fm, d: String(Number(fd)) };
    const t = { y: ty, m: MONTHS[Number(tm) - 1] ?? tm, d: String(Number(td)) };
    if (fromIso === toIso) return `${f.d} ${f.m} ${f.y}`;
    if (fy === ty && fm === tm) return `${f.d}–${t.d} ${t.m} ${t.y}`;
    if (fy === ty) return `${f.d} ${f.m} – ${t.d} ${t.m} ${t.y}`;
    return `${f.d} ${f.m} ${f.y} – ${t.d} ${t.m} ${t.y}`;
}

export const PAYROLL_STATUS_LABELS: Record<PayrollRunStatus, string> = {
    DRAFT:     "Draft",
    POSTED:    "Posted",
    CANCELLED: "Cancelled",
};
