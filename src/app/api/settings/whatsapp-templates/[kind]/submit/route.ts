import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { isWaKind } from "@/shared/lib/whatsapp/billTemplates";
import { WaTemplateError, submitWaTemplate } from "@/shared/lib/whatsapp/waTemplateStore";

type RouteCtx = { params: Promise<{ kind: string }> };

// POST /api/settings/whatsapp-templates/[kind]/submit — send the saved wording
// to Meta for approval.
export async function POST(_req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isWaKind(kind)) {
        return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    }
    try {
        return NextResponse.json({ template: await submitWaTemplate(kind) });
    } catch (e) {
        if (e instanceof WaTemplateError) return NextResponse.json({ error: e.message }, { status: 422 });
        throw e;
    }
}
