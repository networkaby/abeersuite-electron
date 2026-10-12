// Wire shapes of HR → Payroll. Dates are ISO yyyy-mm-dd; money is paise.
//
// A run pays a date RANGE — "from the last payroll to till day" — not a
// calendar month, so every shape here carries periodFrom / periodTo and the
// day counts the proportion was worked out from: `paidDays` working days out of
// `payDays` (26, the government month) — never out of the calendar.

import type { SalaryLine } from "./salaryLines";

export type PayrollRunStatus = "DRAFT" | "POSTED" | "CANCELLED";

/**
 * What has become of the journal a run posted — read from the voucher itself,
 * never assumed from the run's own status.
 *
 * NONE      the run never posted one (a draft).
 * LIVE      the voucher is there and standing. The normal case.
 * DRAFT     the voucher exists but was never posted to the books.
 * CANCELLED the voucher was voided in Accountancy.
 * REMOVED   the voucher is gone — hard-deleted, or soft-deleted. The run still
 *           says POSTED, but the books carry nothing.
 *
 * Anything but NONE or LIVE means the screen must warn: the run looks paid and
 * is not.
 */
export type PayrollVoucherState = "NONE" | "LIVE" | "DRAFT" | "CANCELLED" | "REMOVED";

/** True when a run claims to be posted but its journal is not standing. */
export function voucherIsBroken(status: PayrollRunStatus, state: PayrollVoucherState): boolean {
    return status === "POSTED" && state !== "LIVE";
}

/** The short words the screens put beside the voucher number. */
export const PAYROLL_VOUCHER_STATE_LABELS: Record<PayrollVoucherState, string> = {
    NONE:      "",
    LIVE:      "",
    DRAFT:     "not posted",
    CANCELLED: "cancelled",
    REMOVED:   "removed",
};

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
    /** WORKING days of the period they were employed, and the period's length. */
    paidDays: number;
    periodDays: number;
    /** The divisor the revision carried — one day is a head / this. */
    payDays: number;
    /** Days of the period that fell on their weekly off. 0 on a stored run. */
    weeklyOffDays: number;
    /**
     * The commission part of the pay, in paise. It is ALREADY inside `lines`,
     * `grossPaise` and `netPaise` as an ordinary earning head — never add it on
     * top. It is here only so the sheet can put it in its own column.
     *
     * 0 for everybody until the Commission page exists; HR does not calculate it.
     */
    commissionPaise: number;
    /** How it was worked out, for the breakup. Null on a stored run and while there are no schemes. */
    commissionBasis: string | null;
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
    /** What became of that voucher. Read from the voucher, not guessed. */
    voucherState: PayrollVoucherState;
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
    payDays: number;
    /** The salary revision the figures came from. */
    effectiveFrom: string | null;
}

/**
 * One person on the "who is owed" list. `balance` comes off their salary
 * ledger, which is CREDIT-normal: positive is owed to them, negative is an
 * advance they are still holding.
 */
export interface PayableStaffDto {
    userId: number;
    name: string;
    staffCode: string | null;
    hasLeft: boolean;
    leftOn: string | null;
    ledger: { id: number; name: string };
    balance: number;
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

/**
 * How a figure was arrived at, for a table cell: "22 of 30 · ÷26".
 *
 * The first pair is working days paid out of the period's own length; the
 * divisor is the revision's 26-day month. Both are needed — the same 22 days
 * pay differently on a 26-day month and a 30-day one.
 */
export function formatDayBasis(paidDays: number, periodDays: number, payDays: number): string {
    return `${paidDays} of ${periodDays} · ÷${payDays}`;
}

/** The same, spelled out for the expanded breakup under a person's row. */
export function formatDayBasisLong(paidDays: number, periodDays: number, payDays: number): string {
    const d = paidDays === 1 ? "working day" : "working days";
    return `Pay heads for ${paidDays} ${d} of ${periodDays}, on a ${payDays}-day month`;
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
