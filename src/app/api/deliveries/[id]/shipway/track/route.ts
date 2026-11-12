import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shipwayEnvReady, shipwayTrackByAwb } from "@/modules/delivery/lib/shipway";
import { shipwayStatusToStage } from "@/modules/delivery/lib/shipwayStatus";
import { mirrorStageToOrder } from "@/modules/delivery/lib/mirrorOrderStage";

// POST /api/deliveries/[id]/shipway/track — pull the current Shipway status for
// this delivery's AWB and, if it maps to a later P8 stage, move the delivery and
// mirror the milestone onto the order. This is the poll fallback — the primary
// sync is the /api/shop/shipway-updates webhook (needs the Track module enabled
// in the Shipway account).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (!(await shipwayEnvReady())) {
        return NextResponse.json({ error: "Shipway is not connected." }, { status: 400 });
    }

    try {
        const del = await prisma.ticketDelivery.findUnique({
            where: { ticketId: id },
            select: { awb: true, trackingUrl: true, orderSource: true, orderId: true },
        });
        if (!del?.awb) return NextResponse.json({ error: "This delivery has no AWB yet" }, { status: 400 });

        const t = await shipwayTrackByAwb(del.awb);
        const stage = shipwayStatusToStage({ code: t.statusCode, status: t.currentStatus });
        if (stage) {
            await prisma.ticket.update({ where: { id }, data: { status: stage } });
            await mirrorStageToOrder(del, stage, del.awb).catch(() => undefined);
        }
        // Backfill the shareable tracking URL if it wasn't stored at booking.
        if (!del.trackingUrl && t.trackUrl) {
            await prisma.ticketDelivery
                .update({ where: { ticketId: id }, data: { trackingUrl: t.trackUrl } })
                .catch(() => undefined);
        }
        return NextResponse.json({ ok: true, currentStatus: t.currentStatus ?? t.statusCode, statusId: stage });
    } catch (e) {
        return handleApiError(e, "Failed to refresh tracking");
    }
}
