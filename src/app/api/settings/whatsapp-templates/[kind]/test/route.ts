import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { normalizeMobile10 } from "@/shared/lib/auth/portalIdentifier";
import { WA_BILL_LINK_BASE, hasImageHeader, isWaKind, sampleValuesFor } from "@/shared/lib/whatsapp/billTemplates";
import { encodeUpiPayCode } from "@/modules/pos/lib/upiPayLink";
import { listWaTemplates } from "@/shared/lib/whatsapp/waTemplateStore";
import { billWabaId, isBillSendConfigured, listWaPhoneNumbers, sendBillTemplate } from "@/shared/lib/whatsapp/metaTemplates";
import { wabaParam } from "@/shared/lib/whatsapp/wabaParam";

type RouteCtx = { params: Promise<{ kind: string }> };

const schema = z.object({ mobile: z.string() });

// POST /api/settings/whatsapp-templates/[kind]/test — send the APPROVED copy,
// filled with sample values, to one number. Works while switched off, so a
// template can be checked before bills start using it.
export async function POST(req: Request, { params }: RouteCtx) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;

    const { kind } = await params;
    if (!isWaKind(kind)) {
        return NextResponse.json({ error: "Unknown template kind" }, { status: 404 });
    }
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const mobile10 = normalizeMobile10(data.mobile);
    if (!mobile10) return NextResponse.json({ error: "Enter a 10-digit mobile number." }, { status: 422 });
    if (!(await isBillSendConfigured())) return NextResponse.json({ error: "WhatsApp sending is not set up on this server." }, { status: 422 });

    const t = (await listWaTemplates(wabaParam(req))).find((x) => x.kind === kind);
    if (!t?.approved) return NextResponse.json({ error: "Nothing approved yet — a test can only use an approved template." }, { status: 422 });

    // A template only sends from a number in its own account: the bills number
    // for the bills account, else that account's first Connected number.
    let fromNumberId: string | null = null;
    if (t.wabaId !== (await billWabaId())) {
        const acc = (await listWaPhoneNumbers()).find((a) => a.wabaId === t.wabaId);
        fromNumberId = acc?.numbers.find((n) => n.status === "CONNECTED")?.id ?? null;
        if (!fromNumberId) return NextResponse.json({ error: acc?.error ?? "That account has no Connected number to test from." }, { status: 422 });
    }

    // A photo-header kind (UPI payment request) needs a real, signed sample QR.
    const payCode = hasImageHeader(kind) ? encodeUpiPayCode({ vpa: "shop@upi", amount: 1250, note: "" }) : null;
    try {
        await sendBillTemplate({
            mobile10,
            name: t.approved.name,
            approved: t.approved,
            values: sampleValuesFor(kind),
            linkCode: payCode ?? "0",
            headerImage: payCode ? `${WA_BILL_LINK_BASE}${payCode}/qr` : undefined,
            fromNumberId,
        });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 502 });
    }
}
