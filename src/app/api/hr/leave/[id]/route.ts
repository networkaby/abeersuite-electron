import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { leaveDecisionSchema } from "@/shared/lib/schemas/hrAttendanceSchema";
import { LEAVE_INCLUDE, toLeaveDto, applyLeaveDecision, deleteLeaveRequest } from "@/modules/hr/lib/leaveServer";

// PATCH /api/hr/leave/[id] { status: APPROVED | REJECTED | CANCELLED, decisionNote? }
//
// Approve / reject need hr:leave:approve. Cancel is the requester's own right
// while the request is pending; once approved, cancelling it needs the grant too,
// because it takes LEAVE back off the register.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await validateRequest(req, leaveDecisionSchema);
    if (error) return error;
    try {
        const current = await prisma.leaveRequest.findUnique({ where: { id }, select: { userId: true, status: true } });
        if (!current) return NextResponse.json({ error: "Leave request not found" }, { status: 404 });

        const canApprove = hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE);
        const ownPending = current.userId === user.id && current.status === "PENDING";
        if (data.status === "CANCELLED" ? !(canApprove || ownPending) : !canApprove) {
            return NextResponse.json({ error: "Only HR can decide a leave request" }, { status: 403 });
        }
        if (current.status === data.status) return NextResponse.json({ error: `Already ${data.status.toLowerCase()}` }, { status: 409 });

        const row = await prisma.$transaction((tx) => applyLeaveDecision(tx, id, data.status, data.decisionNote ?? null, user.id));
        return NextResponse.json(toLeaveDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to update the leave request");
    }
}

// DELETE /api/hr/leave/[id] — HR (hr:leave:approve) may delete any request; the
// requester only their own while it is still pending, the same line as Cancel.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const current = await prisma.leaveRequest.findUnique({ where: { id }, select: { userId: true, status: true } });
        if (!current) return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
        const canApprove = hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE);
        if (!canApprove && !(current.userId === user.id && current.status === "PENDING")) {
            return NextResponse.json({ error: "Only HR can delete this leave request" }, { status: 403 });
        }
        await prisma.$transaction((tx) => deleteLeaveRequest(tx, id));
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the leave request");
    }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const row = await prisma.leaveRequest.findUnique({ where: { id }, include: LEAVE_INCLUDE });
        if (!row) return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
        return NextResponse.json(toLeaveDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to fetch the leave request");
    }
}
