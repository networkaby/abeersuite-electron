import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { AI_USES } from "@/shared/lib/constants/ai";
import { invalidateAiSetup } from "@/shared/lib/ai/aiKeys";

// PUT /api/settings/ai-keys/chains { use, step, keyIds } — the keys one step
// tries, in this order (replaces that step's list).

const putSchema = z.object({
    use: z.string().min(1),
    step: z.string().min(1),
    keyIds: z.array(z.number().int().positive()).max(50),
});

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, putSchema);
        if (error) return error;
        const step = AI_USES.find((u) => u.key === data.use)?.steps.find((s) => s.step === data.step);
        if (!step) return NextResponse.json({ error: "Unknown AI use or step" }, { status: 400 });
        const keyIds = [...new Set(data.keyIds)];
        const keys = await prisma.aiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, canPhoto: true, canSearch: true } });
        if (keys.length !== keyIds.length) return NextResponse.json({ error: "A key in the list no longer exists" }, { status: 422 });
        const misfit = keys.find((k) => (step.needs === "photo" && !k.canPhoto) || (step.needs === "search" && !k.canSearch));
        if (misfit) return NextResponse.json({ error: `This step needs keys with the ${step.needs} tick` }, { status: 422 });
        await prisma.$transaction([
            prisma.aiChainStep.deleteMany({ where: { use: data.use, step: data.step } }),
            prisma.aiChainStep.createMany({ data: keyIds.map((keyId, i) => ({ use: data.use, step: data.step, keyId, position: i + 1 })) }),
        ]);
        invalidateAiSetup();
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to save the key order");
    }
}
