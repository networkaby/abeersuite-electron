import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { leaveCreateSchema } from "@/shared/lib/schemas/hrAttendanceSchema";
import { toLeaveDto, LEAVE_INCLUDE } from "@/modules/hr/lib/leaveServer";

// /api/hr/leave — leave requests.
//   GET  ?status=PENDING|APPROVED|REJECTED|CANCELLED (default: every open + this year's decided)
//   POST { userId?, fromDate, toDate, kind, reason } — file a request. For oneself
//        no grant is needed; filing for someone else needs hr:leave:approve.

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const status = new URL(req.url).searchParams.get("status");
        const rows = await prisma.leaveRequest.findMany({
            where: status ? { status } : undefined,
            orderBy: [{ status: "asc" }, { fromDate: "desc" }],
            take: 500,
            include: LEAVE_INCLUDE,
        });
        return NextResponse.json(rows.map(toLeaveDto));
    } catch (e) {
        return handleApiError(e, "Failed to fetch leave requests");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const { data, error } = await validateRequest(req, leaveCreateSchema);
    if (error) return error;
    const userId = data.userId ?? user.id;
    if (userId !== user.id && !hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE)) {
        return NextResponse.json({ error: "Only HR can file leave for someone else" }, { status: 403 });
    }
    try {
        const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!exists) return NextResponse.json({ error: "User not found" }, { status: 404 });
        const row = await prisma.leaveRequest.create({
            data: {
                userId, fromDate: dayOf(data.fromDate), toDate: dayOf(data.toDate),
                kind: data.kind, reason: data.reason?.trim() || null, createdById: user.id,
            },
            include: LEAVE_INCLUDE,
        });
        return NextResponse.json(toLeaveDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to file the leave request");
    }
}
