import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { fetchNumberInfo, listWaNumberViews, waTokenForNumber } from "@/shared/lib/whatsapp/waNumbers";
import { afterWaNumbersChange } from "@/shared/lib/whatsapp/waNumbersApi";

type Ctx = { params: Promise<{ id: string }> };

/** POST — ask Meta about the number with its own token (or the main one). The
 *  answer — CONNECTED / PENDING / … or Meta's refusal — is saved on the record. */
export async function POST(_req: Request, ctx: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const id = Number((await ctx.params).id);
    const n = Number.isInteger(id) ? await prisma.whatsAppNumber.findUnique({ where: { id } }) : null;
    if (!n) return NextResponse.json({ error: "No such number" }, { status: 404 });
    try {
        const token = await waTokenForNumber(n.phoneNumberId);
        let status: string;
        let ok = false;
        try {
            if (!token) throw new Error("No token — set the main token or this number's own.");
            const info = await fetchNumberInfo(n.phoneNumberId, token);
            status = info.status || "OK";
            ok = true;
            // Fill a blank phone from Meta (numbers carried over from the old settings).
            if (!n.phone && info.phone) await prisma.whatsAppNumber.update({ where: { id }, data: { phone: info.phone } });
        } catch (e) {
            status = e instanceof Error ? e.message : String(e);
        }
        await prisma.whatsAppNumber.update({ where: { id }, data: { status: status.slice(0, 500), checkedAt: new Date() } });
        afterWaNumbersChange();
        return NextResponse.json({ ok, status, numbers: await listWaNumberViews() });
    } catch (e) {
        return handleApiError(e, "Test failed");
    }
}
