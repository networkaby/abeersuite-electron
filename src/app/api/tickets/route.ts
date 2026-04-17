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
                technician: true,
                serviceCenter: true,
            },
        });
        return NextResponse.json(tickets);
    } catch {
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
                deviceId: device.id,
                priority: body.priority || "NORMAL",
                notes: body.notes || null,
                accessInfo: body.accessInfo || null,
                estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null,
                technicianId: body.technicianId ? Number(body.technicianId) : null,
            },
            include: {
                device: { include: { customer: true } },
                technician: true,
            },
        });

        // Log initial status
        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status: "RECEIVED",
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