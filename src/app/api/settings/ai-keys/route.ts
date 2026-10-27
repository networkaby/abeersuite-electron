import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { invalidateAiSetup, keyUsages, loadAiSetup } from "@/shared/lib/ai/aiKeys";
import { hasSharedSecret } from "@/shared/lib/ai/secretBox";
import { RELAY_ACTIVE } from "@/shared/lib/counter/relayPolicy";
import { aiKeyBodySchema, aiKeyRowData, savedAiKeyView, aiKeyView } from "@/modules/settings/lib/aiKeysServer";

// Settings → AI Setup. GET = keys + chains + what this server can do;
// POST = add a key.
// GET  /api/settings/ai-keys
// POST /api/settings/ai-keys { name, provider, model, source, envName?, secret?, ...settings }

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_AI_MANAGE);
    if (response) return response;
    try {
        invalidateAiSetup(); // the page always sees the saved rows
        const { keys, chains, copyFlow, photoCheck } = await loadAiSetup();
        const usage = await keyUsages(keys.map((k) => k.id));
        return NextResponse.json({
            keys: keys.map((k) => aiKeyView(k, usage.get(k.id)!)),
            chains,
            copyFlow,
            photoCheck,
            // A relaying till holds no AI keys: saves, tests and AI jobs all go to the office.
            here: { sharedSecret: RELAY_ACTIVE || hasSharedSecret(), runsOnOffice: RELAY_ACTIVE },
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
        return NextResponse.json(await savedAiKeyView(row.id), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to add the AI key");
    }
}
