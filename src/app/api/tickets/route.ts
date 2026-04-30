import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { buildTicketReadScopeWhere } from "@/lib/ticket-scope";

const createTicketSchema = z.object({
    customerId: z.coerce.number().int().positive().optional(),
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
}).refine(d => d.customerId || d.companyId || d.billingAccountId, {
    message: "Either customerId, companyId, or billingAccountId is required",
});

// GET /api/tickets?pipelineId=P1
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId");
        const scopeWhere = buildTicketReadScopeWhere(user);

        const where = {
            AND: [
                ...(pipelineId ? [{ pipelineId }] : []),
                ...(scopeWhere ? [scopeWhere] : []),
            ],
        };

        const tickets = await prisma.ticket.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                device: {
                    include: {
                        account: {
                            select: {
                                id: true, name: true,
                                customer: { select: { phone: true } },
                                company:  { select: { phone: true } },
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
                    phone: t.device.account.customer?.phone ?? t.device.account.company?.phone ?? null,
                } : null,
            },
        }));

        return NextResponse.json(normalised);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission("tickets:create");
    if (response) return response;
    try {
        const parsed = createTicketSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket payload" }, { status: 400 });
        }
        const body = parsed.data;

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
                deviceId:         device.id,
                priority:         body.priority ?? Priority.MEDIUM,
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

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
    }
}
