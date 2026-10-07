import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { listWaTemplates, refreshWaTemplate } from "@/shared/lib/whatsapp/waTemplateStore";

// GET /api/settings/whatsapp-templates — every kind, defaults for unsaved ones.
// A template still with Meta is re-checked on the way, so opening the page is
// how staff see an approval land (no polling job needed).
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    let templates = await listWaTemplates();
    if (templates.some((t) => t.status === "PENDING")) {
        await Promise.all(
            templates.filter((t) => t.status === "PENDING").map((t) => refreshWaTemplate(t.kind).catch(() => null)),
        );
        templates = await listWaTemplates();
    }
    return NextResponse.json({ templates });
}
