import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { invalidateAiSetup } from "@/shared/lib/ai/aiKeys";
import { AI_COPY_FLOWS, type AiCopyFlow } from "@/shared/lib/constants/ai";

// Settings → AI Setup → Product description: the option every product page opens on.
// PUT /api/settings/ai-keys/copy-flow { copyFlow: direct|verified }

const putSchema = z.object({ copyFlow: z.enum(AI_COPY_FLOWS.map((f) => f.value) as [AiCopyFlow, ...AiCopyFlow[]]) });

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        await prisma.orgDefaults.update({ where: { id: 1 }, data: { aiCopyFlow: data.copyFlow } });
        invalidateAiSetup();
        return NextResponse.json({ copyFlow: data.copyFlow });
    } catch (e) {
        return handleApiError(e, "Failed to save the default option");
    }
}
