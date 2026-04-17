import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const ticket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            include: {
                device: { include: { customer: true } },
                technician: true,
                serviceCenter: true,
                ticketPriority: { select: { label: true, color: true } },
                ticketStatus: {
                    include: {
                        fromTransitions: {
                            include: { to: { select: { id: true, label: true } } },
                            orderBy: { toStatusId: "asc" },
                        },
                    },
                },
                logs: {
                    include: {
                        changedBy: true,
                        ticketStatus: { select: { label: true, color: true } },
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch ticket" }, { status: 500 });
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await req.json();

        const ticket = await prisma.ticket.update({
            where: { id: Number(id) },
            data: {
                status: body.status,
                priority: body.priority,
                notes: body.notes,
                accessInfo: body.accessInfo,
                estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null,
                technicianId: body.technicianId ? Number(body.technicianId) : null,
                escalated: body.escalated ?? false,
                escalatedAt: body.escalatedAt ? new Date(body.escalatedAt) : null,
                expectedReturn: body.expectedReturn ? new Date(body.expectedReturn) : null,
                receivedBackAt: body.receivedBackAt ? new Date(body.receivedBackAt) : null,
                externalRef: body.externalRef || null,
                serviceCenterId: body.serviceCenterId ? Number(body.serviceCenterId) : null,
            },
        });

        if (body.status && body.changedBy) {
            await prisma.ticketLog.create({
                data: {
                    ticketId: ticket.id,
                    status: body.status,
                    note: body.logNote || null,
                    userId: Number(body.changedBy),
                },
            });
        }

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }
}