import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { ACCOUNT_LEDGERS } from "@/shared/lib/constants/accounting";
import { paiseToRupees } from "@/shared/lib/format/moneyInr";
import { parseSalaryLines } from "./salaryLines";
import type { PayrollLineDto, PayrollRunDetail, PayrollRunRow, PayrollRunStatus } from "./payrollTypes";
import { formatPeriodMonth } from "./payrollTypes";

/**
 * Payroll, server side.
 *
 * Generating a run is a pure read of the salary structures: for every current
 * staff member, the revision in force on the posting date. Nothing is estimated
 * and nothing is pro-rated — there is no attendance yet, so a month is a month.
 * A person the run cannot pay is still written down, with the reason, so the
 * screen can say "12 not included" instead of silently dropping them.
 */

// ── Month arithmetic ──────────────────────────────────────────────────────────

/** "2026-09" or "2026-09-17" to the first and last day of that month, ISO. */
export function monthBounds(monthish: string): { firstIso: string; lastIso: string } {
    const [y, m] = monthish.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const last = new Date(Date.UTC(y, m, 0));
    return { firstIso: toDateOnlyUtc(first), lastIso: toDateOnlyUtc(last) };
}

/** A DATE column is stored at UTC midnight — the same convention as HR's dates. */
export function dateOnly(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

// ── Generation ────────────────────────────────────────────────────────────────

/** A candidate line, before it is either previewed or written to a run. */
export interface PayrollCandidate {
    userId: number;
    staffName: string;
    staffCode: string | null;
    salaryId: number | null;
    effectiveFrom: string | null;
    lines: ReturnType<typeof parseSalaryLines>;
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    ledger: { id: number; name: string } | null;
    expenseAccount: { id: number; name: string } | null;
    included: boolean;
    skipReason: string | null;
}

/**
 * Everyone who should appear on the run for `postingDateIso`, with the amounts
 * their structure gives them.
 *
 * In: every User who has not left by that date and who had joined by then.
 * Excluded from the journal (but still listed, with a reason): no salary
 * structure yet, no ledger of their own, or a net of zero.
 */
export async function buildPayrollCandidates(
    db: Prisma.TransactionClient,
    postingDateIso: string,
): Promise<PayrollCandidate[]> {
    const postingDate = dateOnly(postingDateIso);

    // The org-wide fallback Dr ledger. Matched by exact name (ACCOUNT_LEDGERS
    // is documented as safe to match by equality, never by substring).
    const fallbackExpense = await db.account.findFirst({
        where: { name: ACCOUNT_LEDGERS.SALARY_WAGES },
        select: { id: true, name: true },
    });

    const users = await db.user.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            staffProfile: {
                select: {
                    staffCode: true,
                    joinedOn: true,
                    leftOn: true,
                    ledgerAccount: { select: { id: true, name: true } },
                    expenseAccount: { select: { id: true, name: true } },
                    // The revision in force on the posting date — one row each,
                    // in the same query, so 300 staff is still one round trip.
                    salaries: {
                        where: { effectiveFrom: { lte: postingDate } },
                        orderBy: { effectiveFrom: "desc" },
                        take: 1,
                        select: { id: true, effectiveFrom: true, linesJson: true, grossPaise: true, netPaise: true },
                    },
                },
            },
        },
    });

    const out: PayrollCandidate[] = [];
    for (const u of users) {
        const p = u.staffProfile;

        // Left on or before the posting date → not on this month's run.
        if (p?.leftOn && toDateOnlyUtc(p.leftOn) <= postingDateIso) continue;
        // Joined after the month ended → not yet on the payroll at all.
        if (p?.joinedOn && toDateOnlyUtc(p.joinedOn) > postingDateIso) continue;

        const salary = p?.salaries[0] ?? null;
        const gross = salary?.grossPaise ?? 0;
        const net = salary?.netPaise ?? 0;
        const ledger = p?.ledgerAccount ?? null;
        const expense = p?.expenseAccount ?? fallbackExpense;

        let skipReason: string | null = null;
        if (!salary) skipReason = "No salary structure entered";
        else if (net <= 0) skipReason = "Net salary is zero";
        else if (!ledger) skipReason = "No ledger — open the staff profile and save it once";
        else if (!expense) skipReason = `No expense ledger — pick one on the Job tab, or create "${ACCOUNT_LEDGERS.SALARY_WAGES}"`;

        out.push({
            userId: u.id,
            staffName: u.name,
            staffCode: p?.staffCode ?? null,
            salaryId: salary?.id ?? null,
            effectiveFrom: salary ? toDateOnlyUtc(salary.effectiveFrom) : null,
            lines: salary ? parseSalaryLines(salary.linesJson) : [],
            grossPaise: gross,
            deductionsPaise: gross - net,
            netPaise: net,
            ledger,
            expenseAccount: expense,
            included: skipReason === null,
            skipReason,
        });
    }
    return out;
}

/** The totals a run header carries — included lines only. */
export function candidateTotals(
    rows: readonly { included: boolean; grossPaise: number; deductionsPaise: number; netPaise: number }[],
) {
    let grossPaise = 0, deductionsPaise = 0, netPaise = 0, headcount = 0;
    for (const r of rows) {
        if (!r.included) continue;
        grossPaise += r.grossPaise;
        deductionsPaise += r.deductionsPaise;
        netPaise += r.netPaise;
        headcount += 1;
    }
    return { grossPaise, deductionsPaise, netPaise, headcount };
}

// ── Reading a stored run ──────────────────────────────────────────────────────

export const PAYROLL_RUN_INCLUDE = {
    lines: { orderBy: { staffName: "asc" as const } },
} satisfies Prisma.PayrollRunInclude;

export type PayrollRunWithLines = Prisma.PayrollRunGetPayload<{ include: typeof PAYROLL_RUN_INCLUDE }>;

export function toRunRow(
    r: Omit<PayrollRunWithLines, "lines">,
    names: Map<number, string>,
): PayrollRunRow {
    return {
        id: r.id,
        periodMonth: toDateOnlyUtc(r.periodMonth),
        postingDate: toDateOnlyUtc(r.postingDate),
        status: r.status as PayrollRunStatus,
        voucherId: r.voucherId,
        voucherRef: r.voucherRef,
        grossPaise: r.grossPaise,
        deductionsPaise: r.deductionsPaise,
        netPaise: r.netPaise,
        headcount: r.headcount,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        postedAt: r.postedAt ? r.postedAt.toISOString() : null,
        createdBy: names.get(r.createdById) ?? null,
        postedBy: r.postedById ? (names.get(r.postedById) ?? null) : null,
    };
}

export function toRunDetail(
    r: PayrollRunWithLines,
    names: Map<number, string>,
    accounts: Map<number, string>,
    staffCodes: Map<number, string | null>,
): PayrollRunDetail {
    const line = (l: PayrollRunWithLines["lines"][number]): PayrollLineDto => ({
        id: l.id,
        userId: l.userId,
        staffName: l.staffName,
        staffCode: staffCodes.get(l.userId) ?? null,
        effectiveFrom: l.effectiveFrom ? toDateOnlyUtc(l.effectiveFrom) : null,
        lines: parseSalaryLines(l.linesJson),
        grossPaise: l.grossPaise,
        deductionsPaise: l.deductionsPaise,
        netPaise: l.netPaise,
        ledger: l.ledgerAccountId ? { id: l.ledgerAccountId, name: accounts.get(l.ledgerAccountId) ?? "—" } : null,
        expenseAccount: l.expenseAccountId ? { id: l.expenseAccountId, name: accounts.get(l.expenseAccountId) ?? "—" } : null,
        included: l.included,
        skipReason: l.skipReason,
    });
    return { ...toRunRow(r, names), lines: r.lines.map(line) };
}

// ── The journal the run posts ─────────────────────────────────────────────────

export interface JournalLineInput {
    accountId: number;
    type: "DEBIT" | "CREDIT";
    amount: number;
    description?: string;
}

/**
 * Turn the included lines into journal lines.
 *
 * Credits are per person — each staff ledger must carry its own net, or the
 * Money tab and the payslip stop agreeing. Debits are grouped by expense
 * ledger, so the P&L reads "Salary & Wages 12,40,000" and not three hundred
 * rows. Rupees, rounded once per line: paise never reach the GL.
 */
export function buildJournalLines(
    rows: readonly {
        included: boolean;
        staffName: string;
        netPaise: number;
        ledgerAccountId: number | null;
        expenseAccountId: number | null;
    }[],
    periodMonthIso: string,
): JournalLineInput[] {
    const period = formatPeriodMonth(periodMonthIso);
    const credits: JournalLineInput[] = [];
    const debitByAccount = new Map<number, number>();

    for (const r of rows) {
        if (!r.included || !r.ledgerAccountId || !r.expenseAccountId || r.netPaise <= 0) continue;
        const rupees = paiseToRupees(r.netPaise);
        credits.push({
            accountId:   r.ledgerAccountId,
            type:        "CREDIT",
            amount:      rupees,
            description: `Salary for ${period} — ${r.staffName}`,
        });
        debitByAccount.set(r.expenseAccountId, (debitByAccount.get(r.expenseAccountId) ?? 0) + rupees);
    }

    const debits: JournalLineInput[] = [...debitByAccount.entries()].map(([accountId, amount]) => ({
        accountId,
        type:        "DEBIT" as const,
        amount,
        description: `Salary for ${period}`,
    }));

    // Debits first — the Dr side reads at the top of a Tally-style journal.
    return [...debits, ...credits];
}
