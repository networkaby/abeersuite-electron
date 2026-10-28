import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { hasSharedSecret } from "@/shared/lib/ai/secretBox";
import { staffName } from "@/modules/campaigns/lib/postServer";
import { incomingStatus, newKey, saveIncoming } from "@/modules/incoming/lib/incomingApi";
import { INCOMING_APIS, type IncomingId } from "@/modules/incoming/lib/incomingCatalog";

// PUT /api/settings/incoming-api/[id] — one caller:
//   { enabled }                         switch on / off
//   { generate: true }                  make a new key; answered ONCE as { key }
//   { secret: "…" }                     keep a pasted secret (Meta's app secret)
//   { secret: "" }                      forget the page's secret (the env var counts again)
//   { settings: { replyMode, rules } }  Cowork only

const schema = z.object({
    enabled: z.boolean().optional(),
    generate: z.literal(true).optional(),
    secret: z.string().trim().max(500).optional(),
    settings: z.object({ replyMode: z.enum(["DRAFT", "POST"]), rules: z.string().max(20_000) }).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.SETTINGS_INCOMING_MANAGE);
    if (response) return response;
    const id = (await ctx.params).id as IncomingId;
    const def = INCOMING_APIS[id];
    if (!def) return NextResponse.json({ error: "Unknown caller" }, { status: 404 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    if (data.generate && !def.canGenerate) return NextResponse.json({ error: "This secret comes from the other side — paste it." }, { status: 400 });
    if (data.settings && id !== "COWORK") return NextResponse.json({ error: "Only the Cowork agent has settings." }, { status: 400 });
    const secret = data.generate ? newKey() : data.secret;
    if (secret && !hasSharedSecret()) return NextResponse.json({ error: "AI_KEY_SECRET is not set on this server — it locks saved secrets." }, { status: 503 });
    if (secret !== undefined && secret !== "" && secret.length < 8) return NextResponse.json({ error: "A secret needs at least 8 characters." }, { status: 400 });
    try {
        await saveIncoming(id, { enabled: data.enabled, secret, settings: data.settings }, await staffName(user.id));
        return NextResponse.json({ ...(await incomingStatus()), ...(data.generate ? { key: secret } : {}) });
    } catch (e) {
        return handleApiError(e, "Failed to save");
    }
}
