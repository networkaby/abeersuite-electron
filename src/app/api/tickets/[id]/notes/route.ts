import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

const noteSchema = z.object({
    note: z.string().trim().min(1, "Note text is required"),
    visibility: z.enum(["INTERNAL", "PUBLIC"]).optional(),
});

// POST /api/tickets/[id]/notes
// Body: { note: string, visibility?: "internal" | "public" }
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user, response } = await requireAuth();
        if (response) return response;

        const { id } = await params;
        const ticketId = Number(id);
        const { data, error } = await validateRequest(req, noteSchema);
        if (error) return error;
        const { note, visibility = "INTERNAL" } = data;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, status: true },
        });
        if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

        const log = await prisma.ticketLog.create({
            data: {
                ticketId,
                status: ticket.status,
                note,
                visibility: visibility === "PUBLIC" ? "PUBLIC" : "INTERNAL",
                author: await buildActorSnapshot(user.id),
            },
        });

        return NextResponse.json(log, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save note");
    }
}
