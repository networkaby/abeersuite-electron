import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";

// PATCH /api/calls/[id] — Call Log triage actions (staff, CRM-gated).
//   • note: add/replace the staff note on this call.
//   • spam: flag/un-flag the NUMBER — applied to every call sharing this call's
//     phone, so past + future calls from it are (un)flagged together.

const patchSchema = z
    .object({
        note: z.string().trim().max(2000).nullable().optional(),
        spam: z.boolean().optional(),
    })
    .refine((v) => v.note !== undefined || v.spam !== undefined, {
        message: "Nothing to update",
    });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;

    try {
        const call = await prisma.call.findUnique({ where: { id }, select: { id: true, phone: true } });
        if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

        if (data.note !== undefined) {
            await prisma.call.update({ where: { id }, data: { note: data.note } });
        }

        // Spam toggles by number. If the call has no phone key (internal/unknown),
        // fall back to flagging just this row.
        if (data.spam !== undefined) {
            if (call.phone) {
                await prisma.call.updateMany({ where: { phone: call.phone }, data: { spam: data.spam } });
            } else {
                await prisma.call.update({ where: { id }, data: { spam: data.spam } });
            }
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update call");
    }
}
