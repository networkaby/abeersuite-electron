import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { paiseToRupees } from "@/shared/lib/format/moneyInr";
import { parseSalaryLines } from "./salaryLines";
import { commissionForPeriod, commissionLine } from "./commission";
import { nonPayableDays } from "./attendancePayable";
import { loadPayRulesContext, payRuleLines } from "./payRulesApply";
import { loadHoursBreakup } from "./attendanceHoursServer";
import { freezeAttendanceForPayslip } from "./attendanceBreakup";
import type { PayslipCommissionData, PayslipAttendanceData } from "@/shared/components/print/PayslipBody";
import { loadPayRules } from "./payRulesServer";
import { dutyMinutesFor } from "@/shared/lib/hr/dutyTime";
import { EMPTY_ATTENDANCE_EFFECT } from "@/shared/lib/hr/payRules";
import { prorate, inclusiveDays, payDaysOf } from "./payrollProrate";
import type { PayrollLineDto, PayrollRunDetail, PayrollRunRow, PayrollRunStatus, PayrollVoucherState } from "./payrollTypes";
import { formatPeriod } from "./payrollTypes";

/**
 * Payroll, server side.
 *
 * A run pays a DATE RANGE — from the day after the last run ended, up to
 * whatever day you are standing on. Generating it is a pure read of the salary
 * structures: for every person employed in that window, their monthly heads
 * proportioned by the WORKING days they were actually employed — the revision's
 * own `payDays` (26 by default) is the divisor and a weekly off is not a day of
 * its own, being already inside the 26 (payrollProrate.ts).
 * Nothing is guessed and nothing is estimated; a person the run cannot pay is
 * still written down with the reason rather than dropped.
 *
 * What his CLOCK did to that figure is the second half, and it comes from the
 * Pay Rules (HR → Pay Rules, `shared/lib/hr/payRules.ts`): a day he was absent
 * or on unpaid leave is not paid (`attendancePayable.nonPayableDays`), and his
 * overtime, his hours still owed, his duty on a closed day, his lateness and an
 * absence nobody granted each become a pay head of their own
 * (`payRulesApply.ts`). Both halves are ordinary salary lines by the time they
 * leave here, so the journal, the payslip and the print template need no
 * special case for any of it.
 */

// ── Dates ─────────────────────────────────────────────────────────────────────

/** A DATE column is stored at UTC midnight — the same convention as HR's dates. */
export function dateOnly(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

/** The day after an ISO date. */
export function nextDayIso(iso: string): string {
    return new Date(Date.parse(`${iso}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Where the next run should start: the day after the furthest day any existing
 * run has already paid. Null when nothing has ever been run — the caller then
 * falls back to the earliest joining date, because the first run has no
 * predecessor to follow on from.
 */
export async function nextPeriodStart(db: Prisma.TransactionClient): Promise<string | null> {
    const last = await db.payrollRun.findFirst({
        where:   { status: { not: "CANCELLED" } },
        orderBy: { periodTo: "desc" },
        select:  { periodTo: true },
    });
    return last ? nextDayIso(toDateOnlyUtc(last.periodTo)) : null;
}

/** The earliest joining date on file — the honest start for a first-ever run. */
export async function earliestJoinedOn(db: Prisma.TransactionClient): Promise<string | null> {
    const first = await db.staffProfile.findFirst({
        where:   { joinedOn: { not: null } },
        orderBy: { joinedOn: "asc" },
        select:  { joinedOn: true },
    });
    return first?.joinedOn ? toDateOnlyUtc(first.joinedOn) : null;
}

/**
 * The run, if any, whose period overlaps [fromIso, toIso].
 *
 * A date range cannot be made unique by the database the way a month could, so
 * this is what stops a day being paid twice. Cancelled runs are ignored: their
 * days are free again.
 */
export async function overlappingRun(
    db: Prisma.TransactionClient,
    fromIso: string,
    toIso: string,
    exceptId?: number,
): Promise<{ id: number; periodFrom: Date; periodTo: Date; status: string } | null> {
    return db.payrollRun.findFirst({
        where: {
            status:     { not: "CANCELLED" },
            periodFrom: { lte: dateOnly(toIso) },
            periodTo:   { gte: dateOnly(fromIso) },
            ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        orderBy: { periodFrom: "asc" },
        select:  { id: true, periodFrom: true, periodTo: true, status: true },
    });
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
    /** The full monthly structure, for the "₹16,000 a month → ₹10,666 for 20 days" line. */
    monthlyNetPaise: number;
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    /** Working days paid, days of the period, and the divisor behind them. */
    paidDays: number;
    periodDays: number;
    payDays: number;
    /** Days of the period that were this person's weekly off. */
    weeklyOffDays: number;
    ledger: { id: number; name: string } | null;
    /**
     * Commission for the period, in paise. Already INSIDE `lines`, `grossPaise`
     * and `netPaise` — it is an earning head like any other; this is only the
     * part of the total that came from commission, so a sheet can name it.
     * 0 for a person no head reaches (see `commission.ts`).
     */
    commissionPaise: number;
    /**
     * The month's attendance accounted day by day, for the slip — frozen with
     * the pay so a day edited later cannot change a slip already handed out.
     * Null for a person with no structure: there is no pay to explain.
     */
    attendance: PayslipAttendanceData | null;
    /** The commission head by head, for the slip — frozen with the pay. Null when there is none. */
    commissionBreakup: PayslipCommissionData | null;
    /** How that commission was arrived at, for the breakup. Null when there is none. */
    commissionBasis: string | null;
    included: boolean;
    skipReason: string | null;
}

/**
 * Everyone who should appear on the run for [fromIso, toIso], with the amounts
 * their structure gives them over exactly the days they were employed.
 *
 * Excluded from the journal (but still listed, with a reason): no salary
 * structure covering the period, not employed in it at all, no ledger of their
 * own, or a net that comes to nothing.
 */
export async function buildPayrollCandidates(
    db: Prisma.TransactionClient,
    fromIso: string,
    toIso: string,
): Promise<PayrollCandidate[]> {
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
                    weeklyOff: true,
                    dutyMinutes: true,
                    dutyStart: true,
                    dutyEnd: true,
                    ledgerAccount: { select: { id: true, name: true } },
                    // Every revision starting on or before the period's last
                    // day: one that lands mid-period has to be honoured for the
                    // days after it, which is why this is not `take: 1`.
                    salaries: {
                        where:   { effectiveFrom: { lte: dateOnly(toIso) } },
                        orderBy: { effectiveFrom: "asc" },
                        select:  { id: true, effectiveFrom: true, linesJson: true, netPaise: true, payDays: true },
                    },
                },
            },
        },
    });

    const periodDays = inclusiveDays(fromIso, toIso);
    // The rules and the shop's calendar are the same for everyone on the run —
    // read once here, never per person.
    const ctx = await loadPayRulesContext(await loadPayRules(), fromIso, toIso);
    // Commission is owned by the Commission page, not by HR. One call for the
    // whole run — and today it always comes back empty, so nothing changes.
    const commissions = await commissionForPeriod(db, users.map((u) => u.id), fromIso, toIso);
    const out: PayrollCandidate[] = [];

    for (const u of users) {
        const p = u.staffProfile;
        const joinedOn = p?.joinedOn ? toDateOnlyUtc(p.joinedOn) : null;
        const leftOn = p?.leftOn ? toDateOnlyUtc(p.leftOn) : null;

        // Never employed inside this window at all — not a skipped row, simply
        // not part of this payroll.
        if (leftOn && leftOn <= fromIso) continue;
        if (joinedOn && joinedOn > toIso) continue;

        const revisions = (p?.salaries ?? []).map((s) => ({
            effectiveFrom: toDateOnlyUtc(s.effectiveFrom),
            lines: parseSalaryLines(s.linesJson),
            payDays: s.payDays,
        }));
        const latest = p?.salaries.length ? p.salaries[p.salaries.length - 1] : null;

        // What the register says about his days, then what the rules make of it.
        // Both are skipped for a person with no structure — there would be
        // nothing to apply them to, and it saves two queries a head.
        let dayFactors: Map<string, 0 | 0.5> | undefined;
        let ruleLines: ReturnType<typeof payRuleLines> = [];
        let attendance: PayslipAttendanceData | null = null;
        if (revisions.length) {
            dayFactors = await nonPayableDays(u.id, fromIso, toIso);
            // The same read the activity screen makes: the days, and the netting
            // (`attendanceEffectFor`) run on them. One source for the card, the
            // pay heads and the slip's working, so the three cannot disagree.
            const hours = await loadHoursBreakup(u.id, fromIso, toIso);
            const effect = hours?.effect ?? { ...EMPTY_ATTENDANCE_EFFECT };
            attendance = hours ? freezeAttendanceForPayslip(hours.days, ctx.rules, effect) : null;
            const latest = p!.salaries[p!.salaries.length - 1];
            ruleLines = payRuleLines(
                effect,
                ctx.rules,
                parseSalaryLines(latest.linesJson),
                latest.payDays,
                dutyMinutesFor(p?.dutyMinutes, p?.dutyStart, p?.dutyEnd),
            );
        }

        const r = prorate({ fromIso, toIso, joinedOn, leftOn, revisions, weeklyOff: p?.weeklyOff ?? [], dayFactors });
        const ledger = p?.ledgerAccount ?? null;

        // The rule heads sit beside the proportioned ones and are totalled with
        // them — an "Overtime" earning and an "Absence penalty" deduction are
        // salary lines like any other.
        // Commission joins them as a third source of heads, and stops being
        // special the moment it does — the totals below cannot tell the three
        // apart, and neither can the payslip or the journal.
        const comm = commissions.get(u.id) ?? null;
        const commissionPaise = comm?.commissionPaise ?? 0;
        const commLine = commissionLine(commissionPaise);

        const lines = [...r.lines, ...ruleLines, ...(commLine ? [commLine] : [])];
        let grossPaise = r.grossPaise, deductionsPaise = r.deductionsPaise;
        for (const l of [...ruleLines, ...(commLine ? [commLine] : [])]) {
            if (l.kind === "EARNING") grossPaise += l.amountPaise;
            else deductionsPaise += l.amountPaise;
        }
        const netPaise = grossPaise - deductionsPaise;

        let skipReason: string | null = null;
        if (!revisions.length) skipReason = "No salary structure entered";
        else if (r.paidDays === 0) {
            skipReason = r.weeklyOffDays > 0
                ? "Only weekly offs fell in this period"
                : "Not on the staff during this period";
        }
        else if (netPaise <= 0) skipReason = "Comes to nothing for this period";
        else if (!ledger) skipReason = "No ledger — open the staff profile and save it once";

        out.push({
            userId: u.id,
            staffName: u.name,
            staffCode: p?.staffCode ?? null,
            salaryId: latest?.id ?? null,
            effectiveFrom: latest ? toDateOnlyUtc(latest.effectiveFrom) : null,
            lines,
            monthlyNetPaise: latest?.netPaise ?? 0,
            grossPaise,
            deductionsPaise,
            netPaise,
            paidDays: r.paidDays,
            periodDays: r.periodDays || periodDays,
            payDays: payDaysOf(latest?.payDays),
            weeklyOffDays: r.weeklyOffDays,
            ledger,
            commissionPaise,
            commissionBasis: commLine ? (comm?.basis ?? null) : null,
            commissionBreakup: commLine ? (comm?.breakup ?? null) : null,
            attendance,
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

/**
 * The voucher, read alongside the run in the same query. This is the whole
 * point of the relation: a run that says POSTED must be able to prove it by
 * the journal's own status, not by the copy of the number it is holding.
 */
export const PAYROLL_VOUCHER_SELECT = { select: { id: true, status: true } } as const;

export const PAYROLL_RUN_INCLUDE = {
    lines: { orderBy: { staffName: "asc" as const } },
    expenseAccount: { select: { id: true, name: true } },
    voucher: PAYROLL_VOUCHER_SELECT,
} satisfies Prisma.PayrollRunInclude;

/**
 * What became of the run's journal.
 *
 * `voucherId` null with `voucherRef` set is REMOVED, not NONE: the FK's
 * SET NULL broke the pointer when the voucher was deleted, and the ref string
 * left behind is the evidence there once was one.
 */
export function voucherStateOf(r: {
    voucherId: number | null;
    voucherRef: string | null;
    voucher?: { status: string } | null;
}): PayrollVoucherState {
    if (!r.voucherId) return r.voucherRef ? "REMOVED" : "NONE";
    if (!r.voucher) return "REMOVED";
    if (r.voucher.status === "CANCELLED") return "CANCELLED";
    if (r.voucher.status === "DRAFT") return "DRAFT";
    return "LIVE";
}

export type PayrollRunWithLines = Prisma.PayrollRunGetPayload<{ include: typeof PAYROLL_RUN_INCLUDE }>;

export function toRunRow(
    r: Omit<PayrollRunWithLines, "lines"> & {
        expenseAccount?: { id: number; name: string } | null;
        voucher?: { status: string } | null;
    },
    names: Map<number, string>,
): PayrollRunRow {
    return {
        id: r.id,
        periodFrom: toDateOnlyUtc(r.periodFrom),
        periodTo: toDateOnlyUtc(r.periodTo),
        postingDate: toDateOnlyUtc(r.postingDate),
        status: r.status as PayrollRunStatus,
        voucherId: r.voucherId,
        voucherRef: r.voucherRef,
        voucherState: voucherStateOf(r),
        expenseAccount: r.expenseAccount ?? null,
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
        monthlyNetPaise: 0,
        grossPaise: l.grossPaise,
        deductionsPaise: l.deductionsPaise,
        netPaise: l.netPaise,
        paidDays: l.paidDays,
        periodDays: l.periodDays,
        payDays: l.payDays,
        weeklyOffDays: 0,
        ledger: l.ledgerAccountId ? { id: l.ledgerAccountId, name: accounts.get(l.ledgerAccountId) ?? "—" } : null,
        // Frozen with the run. The basis is not stored — a stored sentence goes
        // stale the day the scheme is renamed, and the amount is the record.
        commissionPaise: l.commissionPaise,
        commissionBasis: null,
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
    }[],
    expenseAccountId: number,
    periodFromIso: string,
    periodToIso: string,
): JournalLineInput[] {
    const period = formatPeriod(periodFromIso, periodToIso);
    const credits: JournalLineInput[] = [];
    let total = 0;

    for (const r of rows) {
        if (!r.included || !r.ledgerAccountId || r.netPaise <= 0) continue;
        const rupees = paiseToRupees(r.netPaise);
        credits.push({
            accountId:   r.ledgerAccountId,
            type:        "CREDIT",
            amount:      rupees,
            description: `Salary ${period} — ${r.staffName}`,
        });
        total += rupees;
    }
    if (!credits.length) return [];

    // ONE debit for the whole run. Salary expense is an org-wide cost — "what
    // did labour cost the business" is a P&L question, and three hundred staff
    // must not become three hundred lines in it.
    const debit: JournalLineInput = {
        accountId:   expenseAccountId,
        type:        "DEBIT",
        amount:      total,
        description: `Salary ${period}`,
    };

    // Debit first — the Dr side reads at the top of a Tally-style journal.
    return [debit, ...credits];
}
