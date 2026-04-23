import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createTicketSchema = z.object({
    customerId: z.coerce.number().int().positive(),
    deviceType: z.string().trim().min(1, "Device type is required"),
    brand: z.string().trim().min(1, "Brand is required"),
    model: z.string().trim().min(1, "Model is required"),
    problem: z.string().trim().min(1, "Problem is required"),
    priority: z.string().trim().optional(),
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
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const tickets = await prisma.ticket.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                device: {
                    include: { customer: true },
                },
                primaryOwner: true,
                serviceCenter: true,
                ticketStatus: { select: { label: true, color: true } },
                ticketSubStatus: { select: { label: true, color: true } },
                ticketPriority: { select: { label: true, color: true } },
            },
        });
        return NextResponse.json(tickets);
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

        // Create device first
        const device = await prisma.device.create({
            data: {
                type: body.deviceType,
                brand: body.brand,
                model: body.model,
                problem: body.problem,
                customerId: Number(body.customerId),
            },
        });

        // Create ticket
        const ticket = await prisma.ticket.create({
            data: {
                deviceId:      device.id,
                priority:      body.priority || "P2",
                notes:         body.notes || null,
                accessInfo:    body.accessInfo || null,
                estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null,
                primaryOwnerId: body.primaryOwnerId ? Number(body.primaryOwnerId) : null,
                isWarranty:    Boolean(body.isWarranty),
                warrantyStatus: body.isWarranty ? "claimed" : "none",
                warrantyRef:   body.warrantyRef || null,
                purchaseDate:  body.purchaseDate ? new Date(body.purchaseDate) : null,
            },
            include: {
                device: { include: { customer: true } },
                primaryOwner: true,
            },
        });

        // Log initial status
        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status: "S1",
                note: "Ticket created",
                userId: user.id,
            },
        });

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
    }
}
