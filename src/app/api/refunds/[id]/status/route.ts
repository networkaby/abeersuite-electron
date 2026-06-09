import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { assertRefundStatus } from "@/modules/refund/lib/refund";

// PATCH /api/refunds/[id]/status  body { statusId } — move a refund along P9
// (validates the seeded transition graph). The GL pay-back on "Refunded" is a
// follow-up (TODO(refund-apply)); this only advances the tracking stage.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const { statusId } = (await req.json()) as { statusId?: string };
        if (!statusId) return NextResponse.json({ error: "statusId required" }, { status: 400 });

        const refund = await prisma.refund.findUnique({ where: { id }, select: { statusId: true } });
        if (!refund) return NextResponse.json({ error: "Refund not found" }, { status: 404 });

        const check = await assertRefundStatus(statusId);
        if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

        if (refund.statusId && refund.statusId !== statusId) {
            const allowed = await prisma.statusTransition.findFirst({
                where: { fromStatusId: refund.statusId, toStatusId: statusId },
                select: { id: true },
            });
            if (!allowed) {
                return NextResponse.json({ error: "That refund move isn't allowed.", code: "TRANSITION_NOT_ALLOWED" }, { status: 400 });
            }
        }

        await prisma.refund.update({ where: { id }, data: { statusId } });
        return NextResponse.json({ id, statusId });
    } catch (e) {
        return handleApiError(e, "Failed to move refund");
    }
}
