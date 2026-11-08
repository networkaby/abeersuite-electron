import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { CUSTOM_NAME_MAX } from "@/shared/lib/whatsapp/billTemplates";
import { createCustomWaTemplate, listWaTemplatesFresh } from "@/shared/lib/whatsapp/waTemplateStore";

// GET /api/settings/whatsapp-templates — every kind, defaults for unsaved ones.
// A template still with Meta is re-checked on the way, so opening the page is
// how staff see an approval land (no polling job needed).
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    return NextResponse.json({ templates: await listWaTemplatesFresh() });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(CUSTOM_NAME_MAX) });

// POST /api/settings/whatsapp-templates — add a custom template.
export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    return NextResponse.json({ template: await createCustomWaTemplate(data.name) });
}
