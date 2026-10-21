import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { invalidateAiSetup, loadAiSetup } from "@/shared/lib/ai/aiKeys";
import { hasSharedSecret } from "@/shared/lib/ai/secretBox";
import { localKeyStoreAvailable } from "@/shared/lib/ai/aiLocalKeys";
import { aiKeyBodySchema, aiKeyRowData, aiKeyView } from "@/modules/settings/lib/aiKeysServer";

// Settings → AI Setup. GET = keys + chains + what this server can do;
// POST = add a key. A "this PC only" (ini) key's value goes to
// ./[id]/local afterwards, never here — this write may be relayed to the office.
// GET  /api/settings/ai-keys
// POST /api/settings/ai-keys { name, provider, model, source, envName?, secret?, keyHint?, ...settings }

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    try {
        invalidateAiSetup(); // the page always sees the saved rows
        const { keys, chains } = await loadAiSetup();
        return NextResponse.json({
            keys: keys.map(aiKeyView),
            chains,
            here: { sharedSecret: hasSharedSecret(), localStore: localKeyStoreAvailable() },
        });
    } catch (e) {
        return handleApiError(e, "Failed to load AI setup");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, aiKeyBodySchema);
        if (error) return error;
        const built = aiKeyRowData(data);
        if ("error" in built) return NextResponse.json({ error: built.error }, { status: 422 });
        const row = await prisma.aiKey.create({ data: built.row, select: { id: true } });
        invalidateAiSetup();
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add the AI key");
    }
}
