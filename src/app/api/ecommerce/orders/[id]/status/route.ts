import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { transitionShopOrderStatus, transitionOrderPipelineStatus } from "@/modules/ecommerce/lib/order-status";
import { ShopOrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const bodySchema = z.union([
    // Pipeline-based transition (new)
    z.object({
        toStatusId: z.string().min(1),
        courier: z.string().trim().optional().nullable(),
        trackingNumber: z.string().trim().optional().nullable(),
    }),
    // Legacy enum transition (Razorpay / online flow)
    z.object({
        to: z.enum(["DRAFT", "PENDING_PAYMENT", "PAID", "PACKED", "SHIPPED", "DELIVERED", "REFUNDED", "CANCELLED"]),
        courier: z.string().trim().optional().nullable(),
        trackingNumber: z.string().trim().optional().nullable(),
    }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, bodySchema);

    if (error) return error;

    try {
        if ("toStatusId" in data) {
            // Pipeline-based transition
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
        } else {
            // Legacy enum transition (Razorpay / online checkout)
            const { to, courier, trackingNumber } = data;
            const result = await transitionShopOrderStatus({
                orderId: oid,
                to: to as ShopOrderStatus,
                courier,
                trackingNumber,
                actorUserId: user!.id,
            });
            return NextResponse.json({
                order: result.order,
                journalId: result.journalId,
            });
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Status update failed";
        const status = msg.includes("not found") ? 404 : msg.includes("Cannot transition") ? 422 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
}
