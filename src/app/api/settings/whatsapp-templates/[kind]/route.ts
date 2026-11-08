import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { isWaKind } from "@/shared/lib/whatsapp/billTemplates";
import { CUSTOM_NAME_MAX } from "@/shared/lib/whatsapp/billTemplates";
import { WaTemplateError, renameCustomWaTemplate, saveWaTemplate } from "@/shared/lib/whatsapp/waTemplateStore";

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
    if (!isWaKind(kind)) {
        return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    }
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const template = await saveWaTemplate(kind, {
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

const renameSchema = z.object({ name: z.string().trim().min(1).max(CUSTOM_NAME_MAX) });

// PATCH /api/settings/whatsapp-templates/[kind] — rename a custom template.
export async function PATCH(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isWaKind(kind)) return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    const { data, error } = await validateRequest(req, renameSchema);
    if (error) return error;
    try {
        return NextResponse.json({ template: await renameCustomWaTemplate(kind, data.name) });
    } catch (e) {
        if (e instanceof WaTemplateError) return NextResponse.json({ error: e.message }, { status: 409 });
        throw e;
    }
}
