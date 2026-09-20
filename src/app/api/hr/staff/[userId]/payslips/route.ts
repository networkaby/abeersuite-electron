import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { parseSalaryLines } from "@/modules/hr/lib/salaryLines";
import type { PayslipDto } from "@/modules/hr/lib/payrollTypes";

// GET /api/hr/staff/[userId]/payslips — one person's salary slips.
//
// NOT default-open, unlike the rest of HR's reads. What a person is paid is
// their own business and HR's, and nobody else's: the caller must be the person
// themselves or hold hr:staff:edit. This is the one HR read with a gate on it.
//
// Only POSTED runs count. A draft has not happened yet and a cancelled one has
// been taken back out of the books, so neither is a payslip. The figures come
// from the run's own frozen lines, never recomputed — a slip must say the same
// thing in ten years as it did on the day it was posted.

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { user: caller, response } = await requireAuth();
    if (response) return response;

    const userId = Number((await params).userId);
    if (!Number.isInteger(userId) || userId <= 0) {
        return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const isSelf = caller!.id === userId;
    const isHr = hasPermissionWithScope(caller!.permissions, PERMISSIONS.HR_STAFF_EDIT);
    if (!isSelf && !isHr) {
        return NextResponse.json({ error: "You can only see your own salary slips" }, { status: 403 });
    }

    try {
        const lines = await prisma.payrollRunLine.findMany({
            where: {
                userId,
                included: true,
                run: { status: "POSTED" },
            },
            orderBy: { run: { periodTo: "desc" } },
            select: {
                id: true,
                linesJson: true,
                grossPaise: true,
                deductionsPaise: true,
                netPaise: true,
                paidDays: true,
                periodDays: true,
                effectiveFrom: true,
                run: {
                    select: {
                        id: true,
                        periodFrom: true,
                        periodTo: true,
                        postingDate: true,
                        voucherId: true,
                        voucherRef: true,
                        postedAt: true,
                    },
                },
            },
        });

        const slips: PayslipDto[] = lines.map((l) => ({
            id: l.id,
            runId: l.run.id,
            periodFrom: toDateOnlyUtc(l.run.periodFrom),
            periodTo: toDateOnlyUtc(l.run.periodTo),
            postingDate: toDateOnlyUtc(l.run.postingDate),
            postedAt: l.run.postedAt ? l.run.postedAt.toISOString() : null,
            voucherId: l.run.voucherId,
            voucherRef: l.run.voucherRef,
            lines: parseSalaryLines(l.linesJson),
            grossPaise: l.grossPaise,
            deductionsPaise: l.deductionsPaise,
            netPaise: l.netPaise,
            paidDays: l.paidDays,
            periodDays: l.periodDays,
            effectiveFrom: l.effectiveFrom ? toDateOnlyUtc(l.effectiveFrom) : null,
        }));

        return NextResponse.json(slips);
    } catch (e) {
        return handleApiError(e, "Failed to fetch the salary slips");
    }
}
