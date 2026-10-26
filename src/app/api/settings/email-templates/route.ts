import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { listEmailTemplates } from "@/shared/lib/email/emailTemplateStore";

// GET /api/settings/email-templates — every kind, code defaults for unsaved ones.
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    return NextResponse.json({ templates: await listEmailTemplates() });
}
