import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

        const original = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            include: { device: true },
        });

        if (!original) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // Create new ticket for same device
        const newTicket = await prisma.ticket.create({
            data: {
                deviceId: original.deviceId,
                priority: body.priority || original.priority,
                notes: body.notes || null,
                accessInfo: original.accessInfo,
                estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null,
                technicianId: original.technicianId || null,
            },
        });

        // Log it as reopened
        await prisma.ticketLog.create({
            data: {
                ticketId: newTicket.id,
                status: "S1",
                note: `Reopened from Ticket #${original.id} — ${body.reason || "Problem not resolved"}`,
                userId: Number(body.userId),
            },
        });

        return NextResponse.json(newTicket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to reopen ticket" }, { status: 500 });
    }
}