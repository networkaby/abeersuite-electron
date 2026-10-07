import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { WA_TEMPLATE_KINDS, sampleValuesFor, type WaTemplateKind } from "@/shared/lib/whatsapp/billTemplates";
import { listWaTemplates } from "@/shared/lib/whatsapp/waTemplateStore";
import { isBillSendConfigured, sendBillTemplate } from "@/shared/lib/whatsapp/metaTemplates";

type RouteCtx = { params: Promise<{ kind: string }> };

const schema = z.object({ mobile: z.string() });

// POST /api/settings/whatsapp-templates/[kind]/test — send the APPROVED copy,
// filled with sample values, to one number. Works while switched off, so a
// template can be checked before bills start using it.
export async function POST(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!WA_TEMPLATE_KINDS.includes(kind as WaTemplateKind)) {
        return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    }
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const mobile10 = normalizeMobile10(data.mobile);
    if (!mobile10) return NextResponse.json({ error: "Enter a 10-digit mobile number." }, { status: 422 });
    if (!isBillSendConfigured()) return NextResponse.json({ error: "WhatsApp sending is not set up on this server." }, { status: 422 });

    const t = (await listWaTemplates()).find((x) => x.kind === kind);
    if (!t?.approved) return NextResponse.json({ error: "Nothing approved yet — a test can only use an approved template." }, { status: 422 });

    try {
        await sendBillTemplate({ mobile10, name: t.approved.name, approved: t.approved, values: sampleValuesFor(kind as WaTemplateKind), linkCode: "0" });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 502 });
    }
}
