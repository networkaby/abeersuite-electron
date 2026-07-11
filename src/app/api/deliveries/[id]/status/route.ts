import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { assertDeliveryStatus } from "@/modules/delivery/lib/delivery";

// PATCH /api/deliveries/[id]/status  body { statusId } — move a delivery along P8
// (validates the seeded transition graph).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const { statusId } = (await req.json()) as { statusId?: string };
        if (!statusId) return NextResponse.json({ error: "statusId required" }, { status: 400 });

        const delivery = await prisma.ticket.findUnique({ where: { id }, select: { status: true, delivery: { select: { ticketId: true } } } });
        if (!delivery?.delivery) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });

        const check = await assertDeliveryStatus(statusId);
        if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

        if (delivery.status && delivery.status !== statusId) {
            const allowed = await prisma.statusTransition.findFirst({
                where: { fromStatusId: delivery.status, toStatusId: statusId },
                select: { id: true },
            });
            if (!allowed) {
                return NextResponse.json({ error: "That delivery move isn't allowed.", code: "TRANSITION_NOT_ALLOWED" }, { status: 400 });
            }
        }

        await prisma.ticket.update({ where: { id }, data: { status: statusId } });
        return NextResponse.json({ id, statusId });
    } catch (e) {
        return handleApiError(e, "Failed to move delivery");
    }
}
