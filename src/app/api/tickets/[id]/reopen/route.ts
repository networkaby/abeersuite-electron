import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";

const reopenSchema = z.object({
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().trim().optional().or(z.literal("")),
    estimatedCost: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.coerce.number().nonnegative().optional()
    ),
    reason: z.string().trim().optional().or(z.literal("")),
});

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user, response } = await requirePermission("tickets:status:set");
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, reopenSchema);
        if (error) return error;
        const body = data;

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
                primaryOwnerId: original.primaryOwnerId || null,
            },
        });

        // Log it as reopened
        await prisma.ticketLog.create({
            data: {
                ticketId: newTicket.id,
                status: "S1",
                note: `Reopened from Ticket #${original.id} — ${body.reason || "Problem not resolved"}`,
                userId: user.id,
            },
        });

        return NextResponse.json(newTicket);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to reopen ticket" }, { status: 500 });
    }
}
