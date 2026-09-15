import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";

// PATCH /api/calls/[id] — Call Log triage actions. Open to any staff (matches
// /api/help, /api/deals — the write itself only needs an authenticated staff
// session; the counter follow-up popup and the CRM Call Log page both land here).
//   • note: add/replace the staff note on this call. An empty string (as opposed
//     to null) marks the call "seen, nothing to add" — used by the counter
//     follow-up popup's dismiss action so it doesn't re-prompt.
//   • spam: flag/un-flag the NUMBER — applied to every call sharing this call's
//     phone, so past + future calls from it are (un)flagged together.
//   • ticketId: link the help ticket / deal raised from this call — see the
//     `ticketId` doc comment on the Call model.
//   • alsoIds: the OTHER pending calls this same note/ticket answers. A caller
//     who rang five times has one thing to say, and the counter follow-up popup
//     shows those five as one entry — so its single save has to land on all five
//     rows, in one request rather than five round-trips from a till. Ignored by
//     `spam`, which already applies to the whole number by itself.

const patchSchema = z
    .object({
        note: z.string().trim().max(2000).nullable().optional(),
        spam: z.boolean().optional(),
        ticketId: z.number().int().positive().nullable().optional(),
        alsoIds: z.array(z.number().int().positive()).max(50).optional(),
    })
    .refine((v) => v.note !== undefined || v.spam !== undefined || v.ticketId !== undefined, {
        message: "Nothing to update",
    });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;

    try {
        const call = await prisma.call.findUnique({ where: { id }, select: { id: true, phone: true } });
        if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

        // One id or several — `updateMany` covers both, so the grouped save and
        // the single Call Log edit run the exact same write.
        const targetIds = Array.from(new Set([id, ...(data.alsoIds ?? [])]));

        if (data.note !== undefined) {
            await prisma.call.updateMany({ where: { id: { in: targetIds } }, data: { note: data.note } });
        }

        if (data.ticketId !== undefined) {
            await prisma.call.updateMany({ where: { id: { in: targetIds } }, data: { ticketId: data.ticketId } });
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
