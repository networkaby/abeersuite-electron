import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { staffSalaryCreateSchema } from "@/shared/lib/schemas/hrSchema";
import { salaryTotals } from "@/modules/hr/lib/salaryLines";
import { ensureStaffProfile, dateOnlyFromIso, toStaffSalaryDto } from "@/modules/hr/lib/staffProfileServer";

// POST /api/hr/staff/[userId]/salary — add a salary revision.
//
// A revision is the whole structure from its effective date: the lines as sent,
// gross and net computed here so the two totals can never disagree with the
// lines. Two revisions cannot start on the same day. The profile (and its
// ledger) is created first if HR has never saved one — the Pay tab may be the
// first thing filled in.

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;

    const userId = Number((await params).userId);
    if (!Number.isInteger(userId) || userId <= 0) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

    const { data: body, error } = await validateRequest(req, staffSalaryCreateSchema);
    if (error) return error;

    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const { grossPaise, netPaise } = salaryTotals(body.lines);
        const row = await prisma.$transaction(async (tx) => {
            await ensureStaffProfile(tx, user);
            return tx.staffSalary.create({
                data: {
                    userId,
                    effectiveFrom: dateOnlyFromIso(body.effectiveFrom),
                    linesJson: body.lines,
                    grossPaise,
                    netPaise,
                    note: body.note?.trim() || null,
                    createdById: caller.id,
                },
            });
        });
        return NextResponse.json(toStaffSalaryDto(row));
    } catch (e) {
        const conflict = prismaUniqueError(e, "A revision already starts on that date — delete it first, or pick another date");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to add the salary revision");
    }
}
