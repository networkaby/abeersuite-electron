import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { listWaNumberViews, lockWaToken } from "@/shared/lib/whatsapp/waNumbers";
import { accountLabelFor, afterWaNumbersChange, cloudNumberSchema, denyTokenEdit } from "@/shared/lib/whatsapp/waNumbersApi";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return prisma.whatsAppNumber.findUnique({ where: { id } });
}

/** PUT — edit a number. Cloud only: everything; coexistence: only its name
 *  (the wizard owns its ids and token). */
export async function PUT(req: Request, ctx: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const n = await load(ctx);
    if (!n) return NextResponse.json({ error: "No such number" }, { status: 404 });
    try {
        if (n.type === "COEXIST") {
            const { data, error } = await validateRequest(req, z.object({ label: z.string().trim().min(1).max(80) }));
            if (error) return error;
            await prisma.whatsAppNumber.update({ where: { id: n.id }, data: { label: data.label } });
        } else {
            const { data, error } = await validateRequest(req, cloudNumberSchema);
            if (error) return error;
            const denied = await denyTokenEdit(data.token);
            if (denied) return denied;
            const clash = await prisma.whatsAppNumber.findFirst({ where: { phoneNumberId: data.phoneNumberId, id: { not: n.id } }, select: { id: true } });
            if (clash) return NextResponse.json({ error: "Another number already has that phone number ID." }, { status: 409 });
            await prisma.whatsAppNumber.update({
                where: { id: n.id },
                data: {
                    label: data.label,
                    phone: data.phone,
                    phoneNumberId: data.phoneNumberId,
                    wabaId: data.wabaId,
                    accountLabel: data.wabaId === n.wabaId ? n.accountLabel : await accountLabelFor(data.wabaId, data.label, n.id),
                    ...(data.token !== undefined ? { token: lockWaToken(data.token) } : {}),
                    // New ids: the last test no longer applies.
                    ...(data.phoneNumberId !== n.phoneNumberId ? { status: "Not tested", checkedAt: null } : {}),
                },
            });
        }
        afterWaNumbersChange();
        return NextResponse.json({ numbers: await listWaNumberViews() });
    } catch (e) {
        return handleApiError(e, "Could not save the number");
    }
}

const jobSchema = z.object({ useForOtp: z.boolean().optional(), useForBills: z.boolean().optional() });

/** PATCH — switch its jobs. One number carries OTP and one carries bills, so
 *  switching a job on takes it off the number that had it. */
export async function PATCH(req: Request, ctx: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const n = await load(ctx);
    if (!n) return NextResponse.json({ error: "No such number" }, { status: 404 });
    const { data, error } = await validateRequest(req, jobSchema);
    if (error) return error;
    try {
        await prisma.$transaction([
            ...(data.useForOtp ? [prisma.whatsAppNumber.updateMany({ where: { useForOtp: true, id: { not: n.id } }, data: { useForOtp: false } })] : []),
            ...(data.useForBills ? [prisma.whatsAppNumber.updateMany({ where: { useForBills: true, id: { not: n.id } }, data: { useForBills: false } })] : []),
            prisma.whatsAppNumber.update({ where: { id: n.id }, data }),
        ]);
        afterWaNumbersChange();
        return NextResponse.json({ numbers: await listWaNumberViews() });
    } catch (e) {
        return handleApiError(e, "Could not switch the job");
    }
}

/** DELETE — our app stops using it. Chats stay; its account's template
 *  approvals stay for any number added to that account later. Nothing at Meta. */
export async function DELETE(_req: Request, ctx: Ctx) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_APP_MANAGE);
    if (response) return response;
    const n = await load(ctx);
    if (!n) return NextResponse.json({ error: "No such number" }, { status: 404 });
    try {
        await prisma.whatsAppNumber.delete({ where: { id: n.id } });
        afterWaNumbersChange();
        return NextResponse.json({ numbers: await listWaNumberViews() });
    } catch (e) {
        return handleApiError(e, "Could not remove the number");
    }
}
