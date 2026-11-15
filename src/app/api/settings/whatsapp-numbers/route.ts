import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { listWaNumberViews, lockWaToken } from "@/shared/lib/whatsapp/waNumbers";
import { accountLabelFor, afterWaNumbersChange, cloudNumberSchema, denyTokenEdit } from "@/shared/lib/whatsapp/waNumbersApi";

// /api/settings/whatsapp-numbers — App Settings → WhatsApp numbers. One record
// per number (waNumbers.ts). GET lists them; POST adds a Cloud only number
// (coexistence numbers come from /api/settings/whatsapp-connect).

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    try {
        return NextResponse.json({ numbers: await listWaNumberViews() });
    } catch (e) {
        return handleApiError(e, "Could not list WhatsApp numbers");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, cloudNumberSchema);
    if (error) return error;
    const denied = await denyTokenEdit(data.token);
    if (denied) return denied;
    try {
        if (await prisma.whatsAppNumber.findUnique({ where: { phoneNumberId: data.phoneNumberId }, select: { id: true } })) {
            return NextResponse.json({ error: "That phone number ID is already in the list." }, { status: 409 });
        }
        await prisma.whatsAppNumber.create({
            data: {
                label: data.label,
                type: "CLOUD",
                phone: data.phone,
                phoneNumberId: data.phoneNumberId,
                wabaId: data.wabaId,
                accountLabel: await accountLabelFor(data.wabaId, data.label),
                token: lockWaToken(data.token),
            },
        });
        afterWaNumbersChange();
        return NextResponse.json({ numbers: await listWaNumberViews() }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Could not add the number");
    }
}
