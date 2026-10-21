import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { invalidateAiSetup } from "@/shared/lib/ai/aiKeys";
import { aiKeyBodySchema, aiKeyRowData } from "@/modules/settings/lib/aiKeysServer";

// PATCH  /api/settings/ai-keys/[id] — edit a key (empty secret keeps the saved one).
// DELETE /api/settings/ai-keys/[id] — remove it from every chain too (cascade).

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    try {
        const { data, error } = await validateRequest(req, aiKeyBodySchema);
        if (error) return error;
        const prev = await prisma.aiKey.findUnique({ where: { id }, select: { source: true, secretEnc: true, keyHint: true } });
        if (!prev) return NextResponse.json({ error: "Key not found" }, { status: 404 });
        const built = aiKeyRowData(data, prev);
        if ("error" in built) return NextResponse.json({ error: built.error }, { status: 422 });
        await prisma.aiKey.update({ where: { id }, data: built.row });
        invalidateAiSetup();
        return NextResponse.json({ id });
    } catch (e) {
        return handleApiError(e, "Failed to save the AI key");
    }
}

export async function DELETE(_req: Request, { params }: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    try {
        await prisma.aiKey.deleteMany({ where: { id } });
        invalidateAiSetup();
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the AI key");
    }
}
