import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { createActivitySchema } from "@/shared/lib/schemas/dealSchema";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

// Any viewer of the Deals may log an activity (note / call / meeting / task).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;
    const dealId = Number((await params).id);
    if (!Number.isInteger(dealId) || dealId < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, createActivitySchema);
        if (error) return error;

        const lead = await prisma.ticket.findUnique({ where: { id: dealId }, select: { id: true } });
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

        // A deal activity is a TicketLog (body → note).
        const log = await prisma.ticketLog.create({
            data: {
                ticketId: dealId,
                author: await buildActorSnapshot(user.id),
                kind: data.kind,
                note: data.body,
                // dueAt only meaningful for TASK, but harmless on others.
                dueAt: data.kind === "TASK" && data.dueAt ? new Date(data.dueAt) : null,
            },
            select: { id: true, kind: true, note: true, dueAt: true, doneAt: true, createdAt: true, author: true },
        });
        return NextResponse.json({ ...log, body: log.note, note: undefined }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add activity");
    }
}
