import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { listWaAccounts } from "@/shared/lib/whatsapp/metaTemplates";
import { wabaParam } from "@/shared/lib/whatsapp/wabaParam";

// /api/settings/whatsapp-accounts — the WhatsApp accounts we work with, each on
// its own (numbers, template approvals). The OTP and bills accounts from App
// Settings are always listed; a row here adds another or names one.

/** GET — every account, bills account first. */
export async function GET() {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        return NextResponse.json({ accounts: await listWaAccounts() });
    } catch (e) {
        return handleApiError(e, "Could not list WhatsApp accounts");
    }
}

const schema = z.object({
    wabaId: z.string().trim().regex(/^\d{5,25}$/, "WhatsApp account ID: digits only"),
    label: z.string().trim().min(1, "Give it a name").max(80),
});

/** POST { wabaId, label } — add an account, or rename one. */
export async function POST(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        await prisma.whatsAppAccount.upsert({ where: { wabaId: data.wabaId }, create: data, update: { label: data.label } });
        return NextResponse.json({ accounts: await listWaAccounts() });
    } catch (e) {
        return handleApiError(e, "Could not save the WhatsApp account");
    }
}

/** DELETE ?waba= — forget an added account. Its approvals stay (harmless) so
 *  adding it back brings them back. The OTP / bills accounts keep showing. */
export async function DELETE(req: Request) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    const waba = wabaParam(req);
    if (!waba) return NextResponse.json({ error: "Which account?" }, { status: 400 });
    try {
        await prisma.whatsAppAccount.deleteMany({ where: { wabaId: waba } });
        return NextResponse.json({ accounts: await listWaAccounts() });
    } catch (e) {
        return handleApiError(e, "Could not remove the WhatsApp account");
    }
}
