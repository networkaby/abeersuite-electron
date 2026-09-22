import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { payrollRunCreateSchema } from "@/shared/lib/schemas/hrSchema";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import {
    buildPayrollCandidates,
    candidateTotals,
    dateOnly,
    overlappingRun,
    PAYROLL_VOUCHER_SELECT,
    toRunRow,
} from "@/modules/hr/lib/payrollServer";
import { ensureSalaryExpenseAccount } from "@/modules/hr/lib/staffLedger";
import { formatPeriod, type PayrollRunRow } from "@/modules/hr/lib/payrollTypes";

// GET  /api/hr/payroll — the history list, newest period first.
// POST /api/hr/payroll — generate the run for a period.
//
// Generating writes a DRAFT with one line per person, each amount proportioned
// to the days they were employed inside the period and then FROZEN. It does not
// touch the books; posting is a separate call (POST /api/hr/payroll/[id]/post).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const runs = await prisma.payrollRun.findMany({
            orderBy: { periodTo: "desc" },
            // The voucher comes along in the same query — one join, no second
            // round trip — so a run that says POSTED is checked against the
            // journal's own status instead of the number it copied.
            include: {
                expenseAccount: { select: { id: true, name: true } },
                voucher: PAYROLL_VOUCHER_SELECT,
            },
        });

        const ids = [...new Set(runs.flatMap((r) => [r.createdById, r.postedById].filter((v): v is number => v != null)))];
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        const names = new Map(users.map((u) => [u.id, u.name]));

        const rows: PayrollRunRow[] = runs.map((r) => toRunRow(r, names));
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch payroll runs");
    }
}

export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_PAYROLL_RUN);
    if (response) return response;

    const { data: body, error } = await validateRequest(req, payrollRunCreateSchema);
    if (error) return error;

    const { periodFrom, periodTo } = body;
    if (periodTo < periodFrom) {
        return NextResponse.json({ error: "The period ends before it starts" }, { status: 422 });
    }

    // The journal has to fall inside the period it pays, or the P&L for one
    // stretch is short and the next is long.
    const postingDate = body.postingDate ?? periodTo;
    if (postingDate < periodFrom || postingDate > periodTo) {
        return NextResponse.json(
            { error: `The posting date must fall inside ${formatPeriod(periodFrom, periodTo)}` },
            { status: 422 },
        );
    }

    try {
        // No day may be paid twice. A range cannot be made unique by the
        // database the way a month could, so this check is the guard.
        const clash = await overlappingRun(prisma, periodFrom, periodTo);
        if (clash) {
            return NextResponse.json(
                {
                    error: `${formatPeriod(toDateOnlyUtc(clash.periodFrom), toDateOnlyUtc(clash.periodTo))} is already covered by a ${clash.status.toLowerCase()} run. Start this one the day after it ends.`,
                    runId: clash.id,
                },
                { status: 409 },
            );
        }

        const candidates = await buildPayrollCandidates(prisma, periodFrom, periodTo);
        if (!candidates.length) {
            return NextResponse.json({ error: "Nobody was on the staff during that period" }, { status: 422 });
        }
        const totals = candidateTotals(candidates);

        // One ledger for the whole run, resolved now and frozen with it.
        const expenseAccountId = await prisma.$transaction((tx) => ensureSalaryExpenseAccount(tx));

        const run = await prisma.payrollRun.create({
            data: {
                periodFrom:  dateOnly(periodFrom),
                periodTo:    dateOnly(periodTo),
                postingDate: dateOnly(postingDate),
                status:      "DRAFT",
                note:        body.note ?? null,
                createdById: caller!.id,
                expenseAccountId,
                ...totals,
                lines: {
                    create: candidates.map((c) => ({
                        userId:           c.userId,
                        staffName:        c.staffName,
                        salaryId:         c.salaryId,
                        effectiveFrom:    c.effectiveFrom ? dateOnly(c.effectiveFrom) : null,
                        // SalaryLine[] is a declared interface, so it does not satisfy
                        // Prisma's index-signature JSON input type on its own.
                        linesJson:        c.lines as unknown as Prisma.InputJsonValue,
                        grossPaise:       c.grossPaise,
                        deductionsPaise:  c.deductionsPaise,
                        netPaise:         c.netPaise,
                        paidDays:         c.paidDays,
                        periodDays:       c.periodDays,
                        payDays:          c.payDays,
                        // Frozen with everything else. Always 0 today — the
                        // Commission page is what will make it otherwise.
                        commissionPaise:  c.commissionPaise,
                        // The slip's working, frozen with the pay it explains.
                        // Left out, not written as null, when there is none — the
                        // column defaults to NULL and the slip reads that as "no
                        // section", the same as a line from before this existed.
                        ...(c.attendance ? { attendanceJson: c.attendance as unknown as Prisma.InputJsonValue } : {}),
                        ledgerAccountId:  c.ledger?.id ?? null,
                        included:         c.included,
                        skipReason:       c.skipReason,
                    })),
                },
            },
            select: { id: true },
        });

        return NextResponse.json({ id: run.id, ...totals }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to generate the payroll run");
    }
}
