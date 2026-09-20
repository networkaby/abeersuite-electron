import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { payrollRunCreateSchema } from "@/shared/lib/schemas/hrSchema";
import {
    buildPayrollCandidates,
    candidateTotals,
    dateOnly,
    monthBounds,
    toRunRow,
} from "@/modules/hr/lib/payrollServer";
import type { PayrollRunRow } from "@/modules/hr/lib/payrollTypes";

// GET  /api/hr/payroll — the runs list, newest month first.
// POST /api/hr/payroll — generate the run for a month.
//
// Generating writes a DRAFT with one line per staff member, amounts frozen from
// the salary structure in force on the posting date. It does NOT touch the
// books; posting is a separate call (POST /api/hr/payroll/[id]/post), which the
// create route will chain for you when `postImmediately` is set.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const runs = await prisma.payrollRun.findMany({ orderBy: { periodMonth: "desc" } });

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

    const { firstIso, lastIso } = monthBounds(body.periodMonth);
    const postingDateIso = body.postingDate ?? lastIso;

    // The journal must fall inside the month it accrues, or the P&L for that
    // month is short and the next one is long.
    if (postingDateIso < firstIso || postingDateIso > lastIso) {
        return NextResponse.json(
            { error: `The posting date must fall inside ${body.periodMonth} (${firstIso} to ${lastIso})` },
            { status: 422 },
        );
    }

    try {
        const existing = await prisma.payrollRun.findUnique({
            where: { periodMonth: dateOnly(firstIso) },
            select: { id: true, status: true },
        });
        if (existing) {
            return NextResponse.json(
                {
                    error: `${body.periodMonth} already has a ${existing.status.toLowerCase()} run. Open it instead of generating a second one.`,
                    runId: existing.id,
                },
                { status: 409 },
            );
        }

        const candidates = await buildPayrollCandidates(prisma, postingDateIso);
        if (!candidates.length) {
            return NextResponse.json({ error: "No staff were on the payroll in that month" }, { status: 422 });
        }
        const totals = candidateTotals(candidates);

        const run = await prisma.payrollRun.create({
            data: {
                periodMonth: dateOnly(firstIso),
                postingDate: dateOnly(postingDateIso),
                status:      "DRAFT",
                note:        body.note ?? null,
                createdById: caller!.id,
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
                        ledgerAccountId:  c.ledger?.id ?? null,
                        expenseAccountId: c.expenseAccount?.id ?? null,
                        included:         c.included,
                        skipReason:       c.skipReason,
                    })),
                },
            },
            select: { id: true },
        });

        return NextResponse.json({ id: run.id, ...totals, postImmediately: body.postImmediately }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to generate the payroll run");
    }
}
