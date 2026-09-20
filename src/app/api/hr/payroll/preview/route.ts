import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { buildPayrollCandidates, candidateTotals, dateOnly, monthBounds } from "@/modules/hr/lib/payrollServer";
import type { PayrollPreview, PayrollRunStatus } from "@/modules/hr/lib/payrollTypes";

// GET /api/hr/payroll/preview?month=2026-09
//
// What the month WOULD look like. Writes nothing — this is what the "New run"
// dialog shows before anyone commits, and it is also how you check a month you
// have not generated yet. If a run already exists it says so, so the screen can
// send you to it rather than offering a second one.

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? businessTodayIso().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
        return NextResponse.json({ error: "month must look like 2026-09" }, { status: 400 });
    }

    try {
        const { firstIso, lastIso } = monthBounds(month);
        const existing = await prisma.payrollRun.findUnique({
            where: { periodMonth: dateOnly(firstIso) },
            select: { id: true, status: true },
        });

        const candidates = await buildPayrollCandidates(prisma, lastIso);
        const totals = candidateTotals(candidates);

        const payload: PayrollPreview = {
            periodMonth:    firstIso,
            postingDate:    lastIso,
            existingRunId:  existing?.id ?? null,
            existingStatus: (existing?.status as PayrollRunStatus | undefined) ?? null,
            lines: candidates.map((c, i) => ({
                // A preview has no stored rows; the index is a stable key for
                // the table only, never sent back.
                id:              -(i + 1),
                userId:          c.userId,
                staffName:       c.staffName,
                staffCode:       c.staffCode,
                effectiveFrom:   c.effectiveFrom,
                lines:           c.lines,
                grossPaise:      c.grossPaise,
                deductionsPaise: c.deductionsPaise,
                netPaise:        c.netPaise,
                ledger:          c.ledger,
                expenseAccount:  c.expenseAccount,
                included:        c.included,
                skipReason:      c.skipReason,
            })),
            ...totals,
            skippedCount: candidates.filter((c) => !c.included).length,
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to build the payroll preview");
    }
}
