import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { updateActivitySchema } from "@/shared/lib/schemas/dealSchema";

// Toggle a TASK activity done / not-done.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    const { id, aid } = await params;
    const dealId = Number(id);
    const activityId = Number(aid);
    if (!Number.isInteger(dealId) || dealId < 1 || !Number.isInteger(activityId) || activityId < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const { data, error } = await validateRequest(req, updateActivitySchema);
        if (error) return error;

        const existing = await prisma.ticketLog.findFirst({
            where: { id: activityId, ticketId: dealId },
            select: { id: true },
        });
        if (!existing) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

        const log = await prisma.ticketLog.update({
            where: { id: activityId },
            data: { doneAt: data.done ? new Date() : null },
            select: { id: true, kind: true, note: true, dueAt: true, doneAt: true, createdAt: true, author: true },
        });
        return NextResponse.json({ ...log, body: log.note, note: undefined });
    } catch (e) {
        return handleApiError(e, "Failed to update activity");
    }
}
