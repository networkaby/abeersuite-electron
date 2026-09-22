import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { leaveTypeSaveSchema } from "@/shared/lib/schemas/leaveTypeSchema";
import { toLeaveTypeDto } from "@/modules/hr/lib/leaveBalance";

// /api/hr/leave-types — the kinds of leave, and how many days each one allows.
//
//   GET  — every active type. Default-open like the rest of HR's reads: a person
//          filing leave has to be told what the quota is, or the warning in the
//          apply box would be a number out of nowhere.
//   PUT  { id, name?, paid?, yearlyQuota?, carryForward?, carryCap?, noticeDays?, active? }
//          Edit one type. hr:attendance:edit, the same grant that owns the holiday
//          list and the rest of the shop-wide HR calendar.
//
// `code` is deliberately NOT editable: it is what `LeaveRequest.kind` stores, and
// renaming it would orphan every request already filed under it. The display name
// is free to change.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.leaveType.findMany({
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        });
        return NextResponse.json(rows.map(toLeaveTypeDto));
    } catch (e) {
        return handleApiError(e, "Failed to read the leave types");
    }
}

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.HR_ATTENDANCE_EDIT);
    if (response) return response;
    const { data, error } = await validateRequest(req, leaveTypeSaveSchema);
    if (error) return error;
    try {
        const { id, ...rest } = data;
        const row = await prisma.leaveType.update({ where: { id }, data: rest });
        return NextResponse.json(toLeaveTypeDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to save the leave type");
    }
}
