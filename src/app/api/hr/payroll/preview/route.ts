import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import {
    buildPayrollCandidates, candidateTotals, earliestJoinedOn, nextPeriodStart, overlappingRun,
} from "@/modules/hr/lib/payrollServer";
import { formatPeriod, type PayrollPreview } from "@/modules/hr/lib/payrollTypes";

// GET /api/hr/payroll/preview?from=2026-09-01&to=2026-09-20
//
// What the period WOULD pay, per head. Writes nothing — this is the Generate
// tab itself, not a confirmation step, so it is read as often as the dates are
// touched. With no dates it answers the question the screen opens on: what is
// owed from the day after the last payroll up to today.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    if ((fromParam && !ISO.test(fromParam)) || (toParam && !ISO.test(toParam))) {
        return NextResponse.json({ error: "from / to must look like 2026-09-01" }, { status: 400 });
    }

    try {
        const today = businessTodayIso();
        const periodTo = toParam ?? today;

        // Where the period starts when nobody said: after the last run, or —
        // for the very first run, which has no predecessor — the day the
        // earliest staff member joined.
        let startedFrom: PayrollPreview["startedFrom"] = "given";
        let periodFrom = fromParam;
        if (!periodFrom) {
            const afterLast = await nextPeriodStart(prisma);
            if (afterLast) {
                periodFrom = afterLast;
                startedFrom = "after-last-run";
            } else {
                periodFrom = (await earliestJoinedOn(prisma)) ?? `${periodTo.slice(0, 7)}-01`;
                startedFrom = "first-joining";
            }
        }

        if (periodTo < periodFrom) {
            return NextResponse.json({ error: "The period ends before it starts" }, { status: 422 });
        }

        const clash = await overlappingRun(prisma, periodFrom, periodTo);
        const candidates = await buildPayrollCandidates(prisma, periodFrom, periodTo);
        const totals = candidateTotals(candidates);

        const payload: PayrollPreview = {
            periodFrom,
            periodTo,
            startedFrom,
            overlapRunId: clash?.id ?? null,
            overlapLabel: clash
                ? formatPeriod(toDateOnlyUtc(clash.periodFrom), toDateOnlyUtc(clash.periodTo))
                : null,
            lines: candidates.map((c, i) => ({
                // A preview has no stored rows; the index is a stable key for
                // the table only, never sent back.
                id:              -(i + 1),
                userId:          c.userId,
                staffName:       c.staffName,
                staffCode:       c.staffCode,
                effectiveFrom:   c.effectiveFrom,
                lines:           c.lines,
                monthlyNetPaise: c.monthlyNetPaise,
                grossPaise:      c.grossPaise,
                deductionsPaise: c.deductionsPaise,
                netPaise:        c.netPaise,
                paidDays:        c.paidDays,
                periodDays:      c.periodDays,
                ledger:          c.ledger,
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
