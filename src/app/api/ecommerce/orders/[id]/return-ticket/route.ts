import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";
import { z } from "zod";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

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
        const order = await prisma.ticket.findUnique({
            where: { id: oid },
            select: { accountId: true, order: { select: { person: { select: { id: true, name: true } } } } },
        });
        if (!order?.order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const billingAccountId = order.accountId ?? undefined;
        const orderPerson = order.order.person;
        const author = await buildActorSnapshot(user!.id);

        // A return/RMA is a repair Ticket + TicketRepair detail carrying the device and
        // a back-link to the order ticket (sourceOrderTicketId).
        const ticket = await prisma.ticket.create({
            data: {
                priority: Priority.MEDIUM,
                notes:
                    `Return / RMA — shop order #${oid}. ` +
                    (orderPerson ? `Customer: ${orderPerson.name} (#${orderPerson.id}). ` : "") +
                    (billingAccountId ? `Account #${billingAccountId}.` : ""),
                pipelineId: body.pipelineId ?? "P1",
                accountId: billingAccountId ?? null,
                createdBy: author,
                repair: {
                    create: {
                        sourceOrderTicketId: oid,
                        device: {
                            create: {
                                type: body.deviceType,
                                brand: body.brand,
                                model: body.model,
                                problem: body.problem,
                                ...(billingAccountId ? { accountId: billingAccountId } : {}),
                            },
                        },
                    },
                },
            },
            include: { repair: { include: { device: true } } },
        });

        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status: "S1",
                note: "Ticket created from ecommerce return",
                author,
            },
        });

        return NextResponse.json({ ...ticket, ...ticket.repair, device: ticket.repair?.device }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create return ticket");
    }
}
