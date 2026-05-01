import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";

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

        const parsedBody = patchCallLogSchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }

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
            ...parsedBody.data,
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
    } catch (error) {
        console.error("[call-logs PATCH]", error);
        return NextResponse.json({ error: "Failed to update call log" }, { status: 500 });
    }
}
