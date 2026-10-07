import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { listWaTemplatesFresh } from "@/shared/lib/whatsapp/waTemplateStore";

// GET /api/settings/whatsapp-templates — every kind, defaults for unsaved ones.
// A template still with Meta is re-checked on the way, so opening the page is
// how staff see an approval land (no polling job needed).
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    return NextResponse.json({ templates: await listWaTemplatesFresh() });
}
