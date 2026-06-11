import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { findEntrySubStatus } from "@/modules/repairing/lib/entrySubStatus";

const createTicketSchema = z.object({
    sourceShopOrderId: z.coerce.number().int().positive().optional(),
    personId: z.coerce.number().int().positive().optional(),
    companyId: z.coerce.number().int().positive().optional(),
    billingAccountId: z.preprocess(
        (val) => (val == null || val === "") ? undefined : val,
        z.coerce.number().int().positive().optional()
    ),
    deviceType: z.string().trim().min(1, "Device type is required"),
    brand: z.string().trim().min(1, "Brand is required"),
    model: z.string().trim().min(1, "Model is required"),
    problem: z.string().trim().min(1, "Problem is required"),
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().trim().optional().or(z.literal("")),
    accessInfo: z.string().trim().optional().or(z.literal("")),
    estimatedCost: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.coerce.number().nonnegative().optional()
    ),
    primaryOwnerId: z.union([z.coerce.number().int().positive(), z.literal(""), z.undefined()]),
    isWarranty: z.boolean().optional(),
    warrantyRef: z.string().trim().optional().or(z.literal("")),
    purchaseDate: z.string().trim().optional().or(z.literal("")),
    pipelineId: z.string().trim().optional(),
}).refine(
    (d) => Boolean(d.personId || d.companyId || d.billingAccountId || d.sourceShopOrderId),
    {
        message: "Either personId, companyId, billingAccountId, or sourceShopOrderId is required",
    }
);

// GET /api/tickets?pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId");
        // TODO(rbac): scope filtering temporarily removed — any authenticated staff
        // sees all tickets. Re-add buildTicketReadScopeWhere when RBAC is re-wired.
        const where = pipelineId ? { pipelineId } : {};

        const tickets = await prisma.ticket.findMany({
            where,
            orderBy: { createdAt: "desc" },
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
                ticketStatus:    { select: { label: true, color: true } },
                ticketSubStatus: { select: { label: true, color: true } },
                pipeline:        { select: { id: true, label: true, color: true } },
            },
        });

        // Expose a flat phone on device.account for client compatibility
        const normalised = tickets.map(t => ({
            ...t,
            device: {
                ...t.device,
                account: t.device.account ? {
                    ...t.device.account,
                    phone:
                        t.device.account.person?.phones?.[0]?.phone
                        ?? t.device.account.company?.phones?.[0]?.phone
                        ?? null,
                } : null,
            },
        }));

        return NextResponse.json(normalised);
    } catch (e) {
        return handleApiError(e, "Failed to fetch tickets");
    }
}

export async function POST(req: Request) {
    // TODO(rbac): was requirePermission(TICKETS_CREATE) — open to all staff for now.
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createTicketSchema);
        if (error) return error;
        const body = data;

        // Create device — linked to the billing account
        const device = await prisma.device.create({
            data: {
                type: body.deviceType,
                brand: body.brand,
                model: body.model,
                problem: body.problem,
                ...(body.billingAccountId ? { accountId: Number(body.billingAccountId) } : {}),
            },
        });

        // Create ticket
        const ticket = await prisma.ticket.create({
            data: {
                deviceId: device.id,
                ...(body.sourceShopOrderId ? { sourceShopOrderId: body.sourceShopOrderId } : {}),
                priority: body.priority ?? Priority.MEDIUM,
                notes:            body.notes || null,
                accessInfo:       body.accessInfo || null,
                estimatedCost:    body.estimatedCost ? Number(body.estimatedCost) : null,
                primaryOwnerId:   body.primaryOwnerId ? Number(body.primaryOwnerId) : null,
                isWarranty:       Boolean(body.isWarranty),
                warrantyStatus:   body.isWarranty ? "CLAIMED" : "NONE",
                warrantyRef:      body.warrantyRef || null,
                purchaseDate:     body.purchaseDate ? new Date(body.purchaseDate) : null,
                pipelineId:       body.pipelineId || "P1",
                billingAccountId: body.billingAccountId ? Number(body.billingAccountId) : null,
            },
            include: {
                device: { include: { account: { select: { id: true, name: true } } } },
                primaryOwner: true,
            },
        });

        // Log initial status
        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status:   "S1",
                note:     "Ticket created",
                userId:   user.id,
            },
        });

        // Auto-enter the entry-point sub-status for this status (a fromSubStatusId=null
        // transition whose target applies to the status), so a new ticket is immediately
        // a workable item rather than a bare status. Lowest order wins.
        const entrySub = await findEntrySubStatus(ticket.status);
        if (entrySub) {
            await prisma.ticket.update({ where: { id: ticket.id }, data: { subStatusId: entrySub.id } });
            await prisma.ticketLog.create({
                data: { ticketId: ticket.id, status: ticket.status, subStatusId: entrySub.id, note: `Entered: ${entrySub.label}`, userId: user.id },
            });
        }

        return NextResponse.json({ ...ticket, subStatusId: entrySub?.id ?? null });
    } catch (e) {
        return handleApiError(e, "Failed to create ticket");
    }
}
