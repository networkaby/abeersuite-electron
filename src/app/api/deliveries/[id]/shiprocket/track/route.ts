import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { shiprocketEnvReady, shiprocketTrackByAwb } from "@/modules/delivery/lib/shiprocket";
import { shiprocketStatusToStage } from "@/modules/delivery/lib/shiprocketStatus";

// POST /api/deliveries/[id]/shiprocket/track — pull the current Shiprocket status
// for this delivery's AWB and, if it maps to a later P8 stage, move the delivery.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    if (!shiprocketEnvReady()) {
        return NextResponse.json({ error: "Shiprocket is not connected." }, { status: 400 });
    }

    try {
        const del = await prisma.ticketDelivery.findUnique({ where: { ticketId: id }, select: { awb: true } });
        if (!del?.awb) return NextResponse.json({ error: "This delivery has no AWB yet" }, { status: 400 });

        const t = await shiprocketTrackByAwb(del.awb);
        const stage = shiprocketStatusToStage({ statusId: t.currentStatusId, status: t.currentStatus });
        if (stage) {
            await prisma.ticket.update({ where: { id }, data: { status: stage } });
        }
        return NextResponse.json({ ok: true, currentStatus: t.currentStatus, statusId: stage });
    } catch (e) {
        return handleApiError(e, "Failed to refresh tracking");
    }
}
