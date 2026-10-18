import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

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
    // Open to all staff by design — owner's decision (2026-10-18).
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, reopenSchema);
        if (error) return error;
        const body = data;

        const original = await prisma.ticket.findUnique({
            where: { id: Number(id) },
            include: { repair: true },
        });

        if (!original) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }
        if (!original.repair) {
            return NextResponse.json({ error: "Only repair tickets can be reopened" }, { status: 400 });
        }

        // Create a fresh repair ticket for the same device.
        const newTicket = await prisma.ticket.create({
            data: {
                priority:   body.priority || original.priority,
                notes:      body.notes || null,
                pipelineId: original.pipelineId,
                accountId:  original.accountId,
                createdBy:  await buildActorSnapshot(user.id),
                repair: {
                    create: {
                        deviceId:      original.repair.deviceId,
                        accessInfo:    original.repair.accessInfo,
                        estimatedCost: body.estimatedCost ? Number(body.estimatedCost) : null,
                    },
                },
            },
        });

        // Log it as reopened
        await prisma.ticketLog.create({
            data: {
                ticketId: newTicket.id,
                status: "S1",
                note: `Reopened from Ticket #${original.id} — ${body.reason || "Problem not resolved"}`,
                author: await buildActorSnapshot(user.id),
            },
        });

        return NextResponse.json(newTicket);
    } catch (e) {
        return handleApiError(e, "Failed to reopen ticket");
    }
}
