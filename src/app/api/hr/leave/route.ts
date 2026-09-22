import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { leaveCreateSchema, leaveNoticeError } from "@/shared/lib/schemas/hrAttendanceSchema";
import { todayIso } from "@/shared/lib/format/formatDate";
import { toLeaveDto, LEAVE_INCLUDE } from "@/modules/hr/lib/leaveServer";

// /api/hr/leave — leave requests.
//   GET  ?status=PENDING|APPROVED|REJECTED|CANCELLED
//        HR (hr:leave:approve) sees everybody; everyone else sees only their OWN.
//        A leave reason is a private thing — being able to open the board is not
//        a reason to read why a colleague was away.
//   POST { userId?, fromDate, toDate, kind, reason } — file a request. For oneself
//        no grant is needed; filing for someone else needs hr:leave:approve.
//        Filing for oneself must carry the notice Pay Rules asks for — see
//        leaveNoticeError. HR is not held to it.

const dayOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const status = new URL(req.url).searchParams.get("status");
        const all = hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE);
        const rows = await prisma.leaveRequest.findMany({
            where: { ...(status ? { status } : {}), ...(all ? {} : { userId: user.id }) },
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
    /* The notice rule. A person asking for his own leave must give the notice
       Pay Rules asks for; sick leave is outside it. HR filing by hand is outside
       it too — sickness and emergencies are granted across the counter. */
    if (userId === user.id && !hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE)) {
        const notice = leaveNoticeError(data.kind, data.fromDate, todayIso());
        if (notice) return NextResponse.json({ error: notice }, { status: 400 });
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
