import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { addTimelineLogSchema } from "@/shared/lib/schemas/reconnectSchema";

// POST /api/crm/reconnect/log
// Append a note / call / meeting / task straight onto a customer's own timeline.
// No ticket is created — the TicketLog hangs off the Person/Company directly.
export async function POST(req: Request) {
    const { user, response } = await requireModuleAccess("crm");
    if (response) return response;

    const { data, error } = await validateRequest(req, addTimelineLogSchema);
    if (error) return error;

    try {
        // Confirm the customer exists before writing.
        if (data.personId != null) {
            const ok = await prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } });
            if (!ok) return NextResponse.json({ error: "Person not found" }, { status: 404 });
        } else if (data.companyId != null) {
            const ok = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
            if (!ok) return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const log = await prisma.ticketLog.create({
            data: {
                personId: data.personId ?? null,
                companyId: data.companyId ?? null,
                author: await buildActorSnapshot(user.id),
                kind: data.kind,
                note: data.body,
                // dueAt only meaningful for TASK, harmless otherwise.
                dueAt: data.kind === "TASK" && data.dueAt ? new Date(data.dueAt) : null,
                // Call direction (incoming/outgoing) lives on the log's `data` JSON.
                data: data.kind === "CALL" && data.direction ? { direction: data.direction } : undefined,
            },
            select: { id: true, kind: true, note: true, dueAt: true, doneAt: true, createdAt: true, author: true },
        });
        return NextResponse.json(log, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add to timeline");
    }
}
