// GET /api/pos/shifts/handover-candidates?counterId=
//
// Returns users who can accept a handover at the given counter:
//   • Must have pos:shift:open permission (or admin:bypass)
//   • Must NOT already have an OPEN or AWAITING_HANDOVER shift in the branch
//   • Cannot be the current user (can't hand to yourself)
// Used by ShiftCloseDialog to populate the "next cashier" picker.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_CLOSE);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const counterIdParam = searchParams.get("counterId");
    if (!counterIdParam) return NextResponse.json({ error: "counterId required" }, { status: 400 });

    try {
        const session = await auth();
        let branchId: string;
        try { branchId = resolveActiveBranchId(req, session); }
        catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
            throw e;
        }

        // Find users who currently have an active shift at this counter (or anywhere in branch).
        // We exclude anyone with OPEN or AWAITING_HANDOVER to avoid double-shift.
        const busyUserIds = await prisma.posShift.findMany({
            where:  { branchId, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            select: { userId: true },
        }).then((rows) => rows.map((r) => r.userId));

        // Also exclude users who are already the intended recipient of another pending handover.
        const pendingRecipientIds = await prisma.posHandover.findMany({
            where:  { status: "PENDING", fromShift: { branchId } },
            select: { toUserId: true },
        }).then((rows) => rows.map((r) => r.toUserId));

        const excludeIds = [...new Set([...busyUserIds, ...pendingRecipientIds, user!.id])];

        // Get branch users with pos:shift:open permission (via their role).
        // "Branch users" = anyone who holds a Position scoped to this branch,
        // OR any org-wide Position (branchId = null), since org-wide holders
        // have access to every branch.
        const candidates = await prisma.user.findMany({
            where: {
                userPositions: { some: { position: { OR: [{ branchId }, { branchId: null }] } } },
                id:            { notIn: excludeIds },
            },
            select: {
                id:   true,
                name: true,
                email: true,
                role: true,
                userRole: {
                    select: {
                        permissions: {
                            where:  { permissionId: { in: [PERMISSIONS.POS_SHIFT_OPEN, PERMISSIONS.ADMIN_BYPASS] } },
                            select: { permissionId: true },
                        },
                    },
                },
                // Also check user-level permissions.
                userPermissions: {
                    where:  { permissionId: { in: [PERMISSIONS.POS_SHIFT_OPEN, PERMISSIONS.ADMIN_BYPASS] } },
                    select: { permissionId: true },
                },
            },
        });

        // Only include users who have pos:shift:open (via role or user-level grant).
        const eligible = candidates.filter((u) => {
            const rolePerms    = u.userRole?.permissions.map((p) => p.permissionId) ?? [];
            const userPerms    = u.userPermissions.map((p) => p.permissionId);
            const allPerms     = [...rolePerms, ...userPerms];
            return allPerms.includes(PERMISSIONS.POS_SHIFT_OPEN) || allPerms.includes(PERMISSIONS.ADMIN_BYPASS);
        });

        return NextResponse.json(eligible.map((u) => ({
            id:    u.id,
            name:  u.name,
            email: u.email,
            role:  u.role,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch handover candidates");
    }
}
