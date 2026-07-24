import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { updateLifecycleStageSchema } from "@/shared/lib/schemas/reconnectSchema";

// PATCH /api/crm/reconnect/stage
// Nudge a customer's lifecycle stage (Lead → Prospect → Customer → …) from the
// Reconnect right pane. Handles both Person and Company — the old bulk endpoint
// only covered Person.
export async function PATCH(req: Request) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;

    const { data, error } = await validateRequest(req, updateLifecycleStageSchema);
    if (error) return error;

    try {
        if (data.personId != null) {
            await prisma.person.update({
                where: { id: data.personId },
                data: { lifecycleStage: data.lifecycleStage },
            });
        } else if (data.companyId != null) {
            await prisma.company.update({
                where: { id: data.companyId },
                data: { lifecycleStage: data.lifecycleStage },
            });
        }
        return NextResponse.json({ ok: true, lifecycleStage: data.lifecycleStage });
    } catch (e) {
        return handleApiError(e, "Failed to update stage");
    }
}
