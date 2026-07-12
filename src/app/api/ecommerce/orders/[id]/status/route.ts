import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { transitionOrderPipelineStatus } from "@/modules/ecommerce/lib/orderStatus";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

// Pipeline-based transition is the only path. The legacy enum (`{ to }`) flow was
// retired with the COD rebuild — orders ride the sales-orders pipeline (P7).
const bodySchema = z.object({
    toStatusId: z.string().min(1),
    courier: z.string().trim().optional().nullable(),
    trackingNumber: z.string().trim().optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, bodySchema);

    if (error) return error;

    try {
        const { toStatusId, courier, trackingNumber } = data;

        const status = await prisma.ticketStatus.findUnique({
            where: { id: toStatusId },
            select: { label: true },
        });
        if (!status) return NextResponse.json({ error: "Status not found" }, { status: 404 });

        const result = await transitionOrderPipelineStatus({
            orderId: oid,
            toStatusId,
            toStatusLabel: status.label,
            courier,
            trackingNumber,
            actorUserId: user!.id,
        });
        return NextResponse.json({
            order: result.order,
            invoiceId: result.invoiceId,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Status update failed";
        const status = msg.includes("not found") ? 404 : msg.includes("Cannot transition") ? 422 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
}
