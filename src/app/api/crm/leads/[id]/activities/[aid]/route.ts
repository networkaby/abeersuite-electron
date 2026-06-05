import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { updateActivitySchema } from "@/shared/lib/schemas/crmSchema";

// Toggle a TASK activity done / not-done.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.CRM_VIEW);
    if (response) return response;
    const { id, aid } = await params;
    const leadId = Number(id);
    const activityId = Number(aid);
    if (!Number.isInteger(leadId) || leadId < 1 || !Number.isInteger(activityId) || activityId < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    try {
        const { data, error } = await validateRequest(req, updateActivitySchema);
        if (error) return error;

        const existing = await prisma.crmLeadActivity.findFirst({
            where: { id: activityId, leadId },
            select: { id: true },
        });
        if (!existing) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

        const activity = await prisma.crmLeadActivity.update({
            where: { id: activityId },
            data: { doneAt: data.done ? new Date() : null },
            select: { id: true, kind: true, body: true, dueAt: true, doneAt: true, createdAt: true, author: true },
        });
        return NextResponse.json(activity);
    } catch (e) {
        return handleApiError(e, "Failed to update activity");
    }
}
