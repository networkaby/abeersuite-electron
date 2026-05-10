import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const CALL_LOG_NOTE_PREFIX = "CALL_LOG::";

const callDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
const callStatusSchema = z.enum(["CONNECTED", "MISSED", "FAILED", "VOICEMAIL"]);

const patchCallLogSchema = z.object({
    customerName: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(3).optional(),
    direction: callDirectionSchema.optional(),
    status: callStatusSchema.optional(),
    durationSec: z.coerce.number().int().min(0).optional(),
    followUpAmount: z.coerce.number().min(0).optional(),
    note: z.string().trim().max(2000).optional(),
}).refine((val) => Object.keys(val).length > 0, {
    message: "At least one field is required",
});

type PersistedCallLogPayload = {
    customerName: string;
    phone: string;
    direction: z.infer<typeof callDirectionSchema>;
    status: z.infer<typeof callStatusSchema>;
    durationSec: number;
    followUpAmount: number;
    note?: string;
};

function decodeCallLog(rawNote: string | null): PersistedCallLogPayload | null {
    if (!rawNote || !rawNote.startsWith(CALL_LOG_NOTE_PREFIX)) return null;
    const json = rawNote.slice(CALL_LOG_NOTE_PREFIX.length);
    try {
        return JSON.parse(json) as PersistedCallLogPayload;
    } catch {
        return null;
    }
}

function encodeCallLog(payload: PersistedCallLogPayload) {
    return `${CALL_LOG_NOTE_PREFIX}${JSON.stringify(payload)}`;
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const { id } = await params;
        const logId = Number(id);
        if (!Number.isFinite(logId) || logId <= 0) {
            return NextResponse.json({ error: "Invalid call log id" }, { status: 400 });
        }

        const { data, error } = await validateRequest(req, patchCallLogSchema);

        if (error) return error;

        const existing = await prisma.ticketLog.findUnique({
            where: { id: logId },
            select: { id: true, ticketId: true, note: true, createdAt: true },
        });
        if (!existing) return NextResponse.json({ error: "Call log not found" }, { status: 404 });

        const currentPayload = decodeCallLog(existing.note);
        if (!currentPayload) {
            return NextResponse.json({ error: "Ticket log is not a call log entry" }, { status: 400 });
        }

        const nextPayload: PersistedCallLogPayload = {
            ...currentPayload,
            ...data,
        };

        const updated = await prisma.ticketLog.update({
            where: { id: logId },
            data: {
                note: encodeCallLog(nextPayload),
            },
            select: { id: true, ticketId: true, createdAt: true },
        });

        return NextResponse.json({
            id: updated.id,
            ticketId: updated.ticketId,
            ...nextPayload,
            updatedAt: updated.createdAt.toISOString(),
        });
    } catch (e) {
        return handleApiError(e, "Failed to update call log");
    }
}
