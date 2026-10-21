import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { localKeyStoreAvailable, removeLocalKey, saveLocalKey } from "@/shared/lib/ai/aiLocalKeys";

// A "this PC only" (ini) key's value, kept in THIS machine's file. Never relayed
// (relayPolicy.ts NEVER_RELAY) and never written to the database.
// PUT    /api/settings/ai-keys/[id]/local { key } — save / replace it on this PC
// DELETE /api/settings/ai-keys/[id]/local          — forget it on this PC

type Ctx = { params: Promise<{ id: string }> };
const putSchema = z.object({ key: z.string().trim().min(8).max(500) });

export async function PUT(req: Request, { params }: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    if (!localKeyStoreAvailable()) {
        return NextResponse.json({ error: "The website has no PC to keep this key on — open AI Setup in the counter app." }, { status: 422 });
    }
    try {
        const { data, error } = await validateRequest(req, putSchema);
        if (error) return error;
        // The row may still be on its way from the office to this till's replica — a
        // missing row is fine; the file is keyed by its id.
        const row = await prisma.aiKey.findUnique({ where: { id }, select: { source: true } });
        if (row && row.source !== "ini") return NextResponse.json({ error: "This key is not a this-PC key" }, { status: 422 });
        saveLocalKey(id, data.key);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Could not save the key on this PC");
    }
}

export async function DELETE(_req: Request, { params }: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    try {
        if (localKeyStoreAvailable()) removeLocalKey(id);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Could not remove the key from this PC");
    }
}
