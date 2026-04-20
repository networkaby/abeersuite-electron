import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
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
    try {
        const body = await req.json();

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
                userId: Number(body.createdBy),
            },
        });

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
    }
}