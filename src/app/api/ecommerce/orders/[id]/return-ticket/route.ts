import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const bodySchema = z.object({
    deviceType: z.string().trim().min(1).default("Shop return"),
    brand: z.string().trim().min(1),
    model: z.string().trim().min(1),
    problem: z.string().trim().min(1),
    pipelineId: z.string().trim().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;

    const { id } = await ctx.params;
    const oid = parseInt(id, 10);
    if (!Number.isFinite(oid)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;
    const body = data;

    try {
        const order = await prisma.shopOrder.findUnique({
            where: { id: oid },
            include: { person: true },
        });
        if (!order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const billingAccountId = order.accountId ?? undefined;

        const device = await prisma.device.create({
            data: {
                type: body.deviceType,
                brand: body.brand,
                model: body.model,
                problem: body.problem,
                ...(billingAccountId ? { accountId: billingAccountId } : {}),
            },
        });

        const ticket = await prisma.ticket.create({
            data: {
                deviceId: device.id,
                sourceShopOrderId: oid,
                priority: Priority.MEDIUM,
                notes:
                    `Return / RMA — shop order #${oid}. ` +
                    (order.person ? `Customer: ${order.person.name} (#${order.person.id}). ` : "") +
                    (billingAccountId ? `Account #${billingAccountId}.` : ""),
                pipelineId: body.pipelineId ?? "P1",
                billingAccountId: billingAccountId ?? null,
            },
            include: {
                device: true,
            },
        });

        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status: "S1",
                note: "Ticket created from ecommerce return",
                userId: user!.id,
            },
        });

        return NextResponse.json(ticket, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create return ticket");
    }
}
