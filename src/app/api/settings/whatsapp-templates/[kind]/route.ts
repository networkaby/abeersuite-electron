import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { WA_TEMPLATE_KINDS, type WaTemplateKind } from "@/shared/lib/whatsapp/billTemplates";
import { WaTemplateError, saveWaTemplate } from "@/shared/lib/whatsapp/waTemplateStore";

type RouteCtx = { params: Promise<{ kind: string }> };

const buttonText = z.string().trim().max(25).nullable().transform((v) => (v ? v : null));
const schema = z.object({
    enabled: z.boolean(),
    autoSend: z.boolean(),
    body: z.string().max(1024),
    viewButton: buttonText,
    appButton: buttonText,
});

// PUT /api/settings/whatsapp-templates/[kind] — save wording + on/off switch.
export async function PUT(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!WA_TEMPLATE_KINDS.includes(kind as WaTemplateKind)) {
        return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    }
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const template = await saveWaTemplate(kind as WaTemplateKind, {
            enabled: data.enabled,
            autoSend: data.autoSend,
            draft: { body: data.body, viewButton: data.viewButton, appButton: data.appButton },
        });
        return NextResponse.json({ template });
    } catch (e) {
        if (e instanceof WaTemplateError) return NextResponse.json({ error: e.message }, { status: 409 });
        throw e;
    }
}
