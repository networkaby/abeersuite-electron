import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createActivitySchema } from "@/shared/lib/schemas/crmSchema";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

// Any viewer of the CRM may log an activity (note / call / meeting / task).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.CRM_VIEW);
    if (response) return response;
    const leadId = Number((await params).id);
    if (!Number.isInteger(leadId) || leadId < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, createActivitySchema);
        if (error) return error;

        const lead = await prisma.crmLead.findUnique({ where: { id: leadId }, select: { id: true } });
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

        const activity = await prisma.crmLeadActivity.create({
            data: {
                leadId,
                author: await buildActorSnapshot(user.id),
                kind: data.kind,
                body: data.body,
                // dueAt only meaningful for TASK, but harmless on others.
                dueAt: data.kind === "TASK" && data.dueAt ? new Date(data.dueAt) : null,
            },
            select: { id: true, kind: true, body: true, dueAt: true, doneAt: true, createdAt: true, author: true },
        });
        return NextResponse.json(activity, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add activity");
    }
}
