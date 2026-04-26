import { prisma } from "@/lib/prisma";
import { createSystemInboxNotifications } from "@/lib/inbox";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";

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

        const ticket = await prisma.ticket.findUnique({
            where: { id: Number(id) },
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
                    phone: ticket.device.account.customer?.phone ?? ticket.device.account.company?.phone ?? null,
                } : null,
            },
        });
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

        const sessionUser = session.user as {
            id?: string;
            role?: string;
            roles?: string[];
            permissions?: string[];
        };
        const userId = Number(sessionUser.id);
        const userRoles = sessionUser.roles ?? [sessionUser.role ?? ""];
        const permissions = sessionUser.permissions ?? [];
        const isAdmin = permissions.includes("admin:bypass");

        const { id } = await params;
        const parsed = ticketUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket update payload" }, { status: 400 });
        }
        const body = parsed.data;

        // Enforce allowedRoles on main status change (Admin bypasses)
        if (body.status && !isAdmin) {
            const targetStatus = await prisma.ticketStatus.findUnique({
                where: { id: body.status },
                select: { allowedRoles: true, label: true, notifyRoles: true },
            });
            if (
                targetStatus &&
                targetStatus.allowedRoles.length > 0 &&
                !targetStatus.allowedRoles.some(r => userRoles.includes(r))
            ) {
                return NextResponse.json({ error: "Your role cannot set this status." }, { status: 403 });
            }
        }

        if (body.primaryOwnerId !== undefined && !isAdmin && !permissions.includes("tickets:assign")) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
            const targetStatus = await prisma.ticketStatus.findUnique({
                where: { id: body.status },
                select: { id: true, label: true, notifyRoles: true },
            });

            await prisma.ticketLog.create({
                data: {
                    ticketId:   ticket.id,
                    status:     body.status,
                    note:       body.logNote || null,
                    visibility: body.visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                    userId,
                },
            });

            if (targetStatus?.notifyRoles.length) {
                await createSystemInboxNotifications({
                    roleIds: targetStatus.notifyRoles,
                    actorUserId: userId,
                    title: `Ticket #${ticket.id} moved to ${targetStatus.label}`,
                    body: `Next action is now with ${targetStatus.notifyRoles.join(", ")}.`,
                    link: `/tickets/${ticket.id}`,
                });
            }
        }

        return NextResponse.json(ticket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }
}
