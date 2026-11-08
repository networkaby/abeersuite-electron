import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { CUSTOM_NAME_MAX } from "@/shared/lib/whatsapp/billTemplates";
import { createCustomEmailTemplate, listEmailTemplates } from "@/shared/lib/email/emailTemplateStore";

// GET /api/settings/email-templates — every kind, code defaults for unsaved ones.
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    return NextResponse.json({ templates: await listEmailTemplates() });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(CUSTOM_NAME_MAX) });

// POST /api/settings/email-templates — add a custom template.
export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    return NextResponse.json({ template: await createCustomEmailTemplate(data.name) });
}
