import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { phoneMatchKey, phoneKeyVariants, readCallerNumber, normalizeDialedNumber } from "@/shared/lib/format";
import { setNumberSpam } from "@/modules/message/lib/customerMessages";

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
//   • confirmPhone: staff answering "who called?" on a call whose captured
//     number is UNUSABLE — cut off mid-arrival (`91600204286`), or plain wrong
//     (`38446` from trunk C001, a real 38-second call). Writes the full number
//     they gave into the match key, so the row becomes a normal matched call
//     everywhere. Pass null to undo a wrong pick. `rawNumber` is NEVER touched:
//     it is the audit of what the PBX actually sent, and the pair (unusable
//     rawNumber + a phone key) is what records that a human supplied this one.
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
        confirmPhone: z.string().trim().max(20).nullable().optional(),
        alsoIds: z.array(z.number().int().positive()).max(50).optional(),
    })
    .refine((v) => v.note !== undefined || v.spam !== undefined || v.ticketId !== undefined || v.confirmPhone !== undefined, {
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
        const call = await prisma.call.findUnique({
            where: { id },
            select: { id: true, phone: true, rawNumber: true, direction: true },
        });
        if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

        // Giving a call a number decides WHO it belonged to, so it is guarded —
        // but only where a guard can do better than the human. The captured
        // number must be UNUSABLE: a whole, valid number can never be reassigned
        // to someone else. The answer must be a real ten-digit number, and it
        // must BELONG TO AN EXISTING CUSTOMER — we confirm an identity, we never
        // invent a number.
        //
        // We deliberately do NOT insist the answer starts with the digits the
        // PBX delivered. That holds for a number cut off mid-arrival, but a
        // wrong CLI (`38446`) shares nothing with the real number, and the call
        // is still real — only a person who took it can say who rang. The
        // evidence survives either way: `rawNumber` keeps what the PBX sent, so
        // a staff-supplied number is always visible as exactly that.
        //
        // Clearing (null) is allowed on the same calls only, so a genuinely
        // matched call can never be unmatched by accident.
        if (data.confirmPhone !== undefined) {
            const captured = readCallerNumber(
                call.direction === "OUTGOING" ? normalizeDialedNumber(call.rawNumber) : call.rawNumber,
            );
            if (captured.shape !== "partial") {
                return NextResponse.json(
                    { error: "This call's number is not a broken capture" },
                    { status: 422 },
                );
            }
            if (data.confirmPhone === null) {
                await prisma.call.update({ where: { id }, data: { phone: null } });
                return NextResponse.json({ success: true });
            }
            const key = phoneMatchKey(data.confirmPhone);
            if (!key) {
                return NextResponse.json({ error: "That is not a complete number" }, { status: 422 });
            }
            const owned = await prisma.phone.findFirst({
                where: { phone: { in: phoneKeyVariants(key) } },
                select: { id: true },
            });
            if (!owned) {
                return NextResponse.json({ error: "No customer holds that number" }, { status: 422 });
            }
            await prisma.call.update({ where: { id }, data: { phone: key } });
            return NextResponse.json({ success: true });
        }

        // One id or several — `updateMany` covers both, so the grouped save and
        // the single Call Log edit run the exact same write.
        const targetIds = Array.from(new Set([id, ...(data.alsoIds ?? [])]));

        if (data.note !== undefined) {
            await prisma.call.updateMany({ where: { id: { in: targetIds } }, data: { note: data.note } });
        }

        if (data.ticketId !== undefined) {
            await prisma.call.updateMany({ where: { id: { in: targetIds } }, data: { ticketId: data.ticketId } });
        }

        // Spam toggles by number — calls, messages and the Meta block together
        // (setNumberSpam). No phone key (internal/unknown): just this row.
        if (data.spam !== undefined) {
            if (call.phone) {
                await setNumberSpam(call.phone, data.spam);
            } else {
                await prisma.call.update({ where: { id }, data: { spam: data.spam } });
            }
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to update call");
    }
}
