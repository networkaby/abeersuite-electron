import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import { passesWorkGate } from "@/modules/repairing/lib/workGate";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

const ticketUpdateSchema = z.object({
    status: z.string().trim().optional(),
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().optional(),
    accessInfo: z.string().optional(),
    estimatedCost: z.preprocess(
        (value) => value === "" ? null : value,
        z.union([z.coerce.number().nonnegative(), z.null()]).optional()
    ),
    primaryOwnerId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
    escalated: z.boolean().optional(),
    escalatedAt: z.string().optional().nullable(),
    expectedReturn: z.string().optional().nullable(),
    receivedBackAt: z.string().optional().nullable(),
    externalRef: z.string().optional(),
    serviceCenterId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
    isWarranty: z.boolean().optional(),
    warrantyRef: z.string().optional(),
    purchaseDate: z.string().optional().nullable(),
    logNote: z.string().optional(),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        // TODO(rbac): scope filtering removed — any authenticated staff can read any ticket.

        const ticket = await prisma.ticket.findFirst({
            where: {
                id: Number(id),
            },
            include: {
                device: {
                    include: {
                        account: {
                            select: {
                                id: true, name: true,
                                person: {
                                    select: {
                                        phones: selectPrimaryPhone,
                                    },
                                },
                                company: {
                                    select: {
                                        phones: selectPrimaryPhone,
                                    },
                                },
                            },
                        },
                    },
                },
                primaryOwner: true,
                serviceCenter: true,
                ticketStatus: {
                    include: {
                        fromTransitions: {
                            include: { to: { select: { id: true, label: true } } },
                            orderBy: { toStatusId: "asc" },
                        },
                    },
                },
                ticketSubStatus: { select: { id: true, label: true, color: true } },
                pipeline:        { select: { id: true, label: true, color: true } },
                participants: {
                    where: { removedAt: null },
                    include: { user: { select: { id: true, name: true, role: true } } },
                    orderBy: { createdAt: "asc" },
                },
                logs: {
                    include: {
                        changedBy: true,
                        ticketStatus:    { select: { label: true, color: true } },
                        ticketSubStatus: { select: { label: true, color: true } },
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

        return NextResponse.json({
            ...ticket,
            device: {
                ...ticket.device,
                account: ticket.device.account ? {
                    ...ticket.device.account,
                    phone:
                        ticket.device.account.person?.phones?.[0]?.phone
                        ?? ticket.device.account.company?.phones?.[0]?.phone
                        ?? null,
                } : null,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch ticket");
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const resolvedUser = resolvedUserFromSession(session);
        const userId = resolvedUser.id;

        const { id } = await params;
        const scopedTicket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            select: { id: true, status: true },
        });
        if (!scopedTicket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const { data, error } = await validateRequest(req, ticketUpdateSchema);

        if (error) return error;
        const body = data;

        // Work-permission gate on status changes: a target status carrying a gated
        // Work requires that permission. Statuses with no/ungated Work are open.
        if (body.status) {
            const targetStatus = await prisma.ticketStatus.findUnique({
                where: { id: body.status },
                select: { work: { select: { permissionId: true } } },
            });
            if (!passesWorkGate(resolvedUser, targetStatus?.work ?? null)) {
                return NextResponse.json({ error: "You don't have permission for this work" }, { status: 403 });
            }
        }

        const ticket = await prisma.ticket.update({
            where: { id: Number(id) },
            data: {
                ...(body.status !== undefined       && { status: body.status }),
                ...(body.priority !== undefined     && { priority: body.priority }),
                ...(body.notes !== undefined        && { notes: body.notes }),
                ...(body.accessInfo !== undefined   && { accessInfo: body.accessInfo }),
                ...(body.estimatedCost !== undefined && { estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null }),
                ...(body.primaryOwnerId !== undefined && { primaryOwnerId: body.primaryOwnerId ? Number(body.primaryOwnerId) : null }),
                ...(body.escalated !== undefined    && { escalated: body.escalated }),
                ...(body.escalatedAt !== undefined  && { escalatedAt: body.escalatedAt ? new Date(body.escalatedAt) : null }),
                ...(body.expectedReturn !== undefined && { expectedReturn: body.expectedReturn ? new Date(body.expectedReturn) : null }),
                ...(body.receivedBackAt !== undefined && { receivedBackAt: body.receivedBackAt ? new Date(body.receivedBackAt) : null }),
                ...(body.externalRef !== undefined  && { externalRef: body.externalRef || null }),
                ...(body.serviceCenterId !== undefined && { serviceCenterId: body.serviceCenterId ? Number(body.serviceCenterId) : null }),
                ...(body.isWarranty !== undefined   && { isWarranty: Boolean(body.isWarranty) }),
                ...(body.warrantyRef !== undefined  && { warrantyRef: body.warrantyRef || null }),
                ...(body.purchaseDate !== undefined && { purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null }),
            },
        });

        if (body.status) {
            await prisma.ticketLog.create({
                data: {
                    ticketId:   ticket.id,
                    status:     body.status,
                    note:       body.logNote || null,
                    visibility: body.visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                    userId,
                },
            });
            // TODO(notify): ticket status notifications detached — re-add a
            // notification system decoupled from the repair module later.
        }

        return NextResponse.json(ticket);
    } catch (e) {
        return handleApiError(e, "Failed to update ticket");
    }
}
