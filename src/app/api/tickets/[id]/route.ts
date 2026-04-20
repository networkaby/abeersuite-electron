import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

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
                primaryOwner: true,
                serviceCenter: true,
                ticketPriority: { select: { label: true, color: true } },
                ticketStatus: {
                    include: {
                        fromTransitions: {
                            include: { to: { select: { id: true, label: true } } },
                            orderBy: { toStatusId: "asc" },
                        },
                    },
                    // include isTerminal so the client can conditionally show escalation
                },
                ticketSubStatus: { select: { id: true, label: true, color: true } },
                participants: {
                    where: { removedAt: null },
                    include: { user: { select: { id: true, name: true, role: true } } },
                    orderBy: { createdAt: "asc" },
                },
                logs: {
                    include: {
                        changedBy: true,
                        ticketStatus: { select: { label: true, color: true } },
                        ticketSubStatus: { select: { label: true, color: true } },
                    },
                    orderBy: { createdAt: "desc" },
                },
                warrantyLogs: {
                    include: { changedBy: { select: { name: true } } },
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
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const userId = Number((session.user as { id?: string }).id);
        const userRole = (session.user as { role?: string }).role ?? "";

        const { id } = await params;
        const body = await req.json();

        // Enforce allowedRoles on main status change (Admin bypasses)
        if (body.status && userRole !== "R1") {
            const targetStatus = await prisma.ticketStatus.findUnique({
                where: { id: body.status },
                select: { allowedRoles: true },
            });
            if (
                targetStatus &&
                targetStatus.allowedRoles.length > 0 &&
                !targetStatus.allowedRoles.includes(userRole)
            ) {
                return NextResponse.json({ error: "Your role cannot set this status." }, { status: 403 });
            }
        }

        // Fetch current state BEFORE update (needed for escalation task logic)
        const prevState = body.escalated !== undefined
            ? await prisma.ticket.findUnique({
                where: { id: Number(id) },
                select: {
                    escalated: true,
                    device: { select: { brand: true, model: true, customer: { select: { name: true } } } },
                },
              })
            : null;

        const ticket = await prisma.ticket.update({
            where: { id: Number(id) },
            data: {
                ...(body.status      !== undefined && { status: body.status }),
                ...(body.priority    !== undefined && { priority: body.priority }),
                ...(body.notes       !== undefined && { notes: body.notes }),
                ...(body.accessInfo  !== undefined && { accessInfo: body.accessInfo }),
                ...(body.estimatedCost !== undefined && { estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null }),
                ...(body.primaryOwnerId !== undefined && { primaryOwnerId: body.primaryOwnerId ? Number(body.primaryOwnerId) : null }),
                ...(body.escalated   !== undefined && { escalated: body.escalated }),
                ...(body.escalatedAt !== undefined && { escalatedAt: body.escalatedAt ? new Date(body.escalatedAt) : null }),
                ...(body.expectedReturn !== undefined && { expectedReturn: body.expectedReturn ? new Date(body.expectedReturn) : null }),
                ...(body.receivedBackAt !== undefined && { receivedBackAt: body.receivedBackAt ? new Date(body.receivedBackAt) : null }),
                ...(body.externalRef !== undefined && { externalRef: body.externalRef || null }),
                ...(body.serviceCenterId !== undefined && { serviceCenterId: body.serviceCenterId ? Number(body.serviceCenterId) : null }),
                ...(body.isWarranty  !== undefined && { isWarranty: Boolean(body.isWarranty) }),
                ...(body.warrantyRef !== undefined && { warrantyRef: body.warrantyRef || null }),
                ...(body.purchaseDate !== undefined && { purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null }),
            },
        });

        if (body.status) {
            await prisma.ticketLog.create({
                data: {
                    ticketId: ticket.id,
                    status: body.status,
                    note: body.logNote || null,
                    visibility: body.visibility === "public" ? "public" : "internal",
                    userId,
                },
            });
        }

        // When freshly escalating to a service centre, auto-create a Despatch task (R4)
        if (body.escalated === true && prevState && !prevState.escalated) {
            const deviceLabel = `${prevState.device.brand} ${prevState.device.model}`;
            try {
                await prisma.task.create({
                    data: {
                        title:        `Contact service centre — Ticket #${ticket.id} (${deviceLabel})`,
                        description:  `Customer: ${prevState.device.customer.name}. Determine if on-site engineer visit or device despatch is required. Record external ref once confirmed.`,
                        source:       "ticket_workflow",
                        status:       "open",
                        priority:     ticket.priority,
                        assignedRole: "R4",
                        ticketId:     ticket.id,
                        createdById:  userId,
                    },
                });
            } catch (taskErr) {
                console.warn("[ticket PUT] escalation task creation skipped:", taskErr);
            }
        }

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }
}