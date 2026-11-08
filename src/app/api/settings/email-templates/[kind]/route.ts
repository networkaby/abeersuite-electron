import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { EMAIL_BODY_MAX, EMAIL_SUBJECT_MAX, isEmailAnyKind } from "@/shared/lib/email/emailTemplates";
import { CUSTOM_NAME_MAX } from "@/shared/lib/whatsapp/billTemplates";
import { EmailTemplateError, renameCustomEmailTemplate, saveEmailTemplate } from "@/shared/lib/email/emailTemplateStore";

type RouteCtx = { params: Promise<{ kind: string }> };

const schema = z.object({
    enabled: z.boolean(),
    autoSend: z.boolean(),
    subject: z.string().max(EMAIL_SUBJECT_MAX),
    body: z.string().max(EMAIL_BODY_MAX),
});

// PUT /api/settings/email-templates/[kind] — save subject, body and the two switches.
export async function PUT(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isEmailAnyKind(kind)) return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const template = await saveEmailTemplate(kind, {
            enabled: data.enabled,
            autoSend: data.autoSend,
            draft: { subject: data.subject, body: data.body },
        });
        return NextResponse.json({ template });
    } catch (e) {
        if (e instanceof EmailTemplateError) return NextResponse.json({ error: e.message }, { status: 422 });
        throw e;
    }
}

const renameSchema = z.object({ name: z.string().trim().min(1).max(CUSTOM_NAME_MAX) });

// PATCH /api/settings/email-templates/[kind] — rename a custom template.
export async function PATCH(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isEmailAnyKind(kind)) return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    const { data, error } = await validateRequest(req, renameSchema);
    if (error) return error;
    try {
        return NextResponse.json({ template: await renameCustomEmailTemplate(kind, data.name) });
    } catch (e) {
        if (e instanceof EmailTemplateError) return NextResponse.json({ error: e.message }, { status: 409 });
        throw e;
    }
}
