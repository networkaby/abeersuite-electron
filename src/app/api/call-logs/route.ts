import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import type { Prisma } from "@/generated/prisma/client";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

const CALL_LOG_NOTE_PREFIX = "CALL_LOG::";

const callDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
const callStatusSchema = z.enum(["CONNECTED", "MISSED", "FAILED", "VOICEMAIL"]);

const createCallLogSchema = z.object({
    ticketId: z.coerce.number().int().positive("ticketId is required"),
    customerName: z.string().trim().min(1, "customerName is required"),
    phone: z.string().trim().min(3, "phone is required"),
    direction: callDirectionSchema,
    status: callStatusSchema,
    durationSec: z.coerce.number().int().min(0).default(0),
    followUpAmount: z.coerce.number().min(0).default(0),
    note: z.string().trim().max(2000).optional(),
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

const persistedPayloadSchema = createCallLogSchema.omit({ ticketId: true });

function encodeCallLog(payload: PersistedCallLogPayload) {
    return `${CALL_LOG_NOTE_PREFIX}${JSON.stringify(payload)}`;
}

function decodeCallLog(rawNote: string | null): PersistedCallLogPayload | null {
    if (!rawNote || !rawNote.startsWith(CALL_LOG_NOTE_PREFIX)) return null;
    const json = rawNote.slice(CALL_LOG_NOTE_PREFIX.length);
    try {
        return persistedPayloadSchema.parse(JSON.parse(json));
    } catch {
        return null;
    }
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const { searchParams } = new URL(req.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20));
        const search = searchParams.get("search")?.trim() ?? "";
        const parsedStatus = callStatusSchema.safeParse(searchParams.get("status"));
        const parsedDirection = callDirectionSchema.safeParse(searchParams.get("direction"));
        const status = parsedStatus.success ? parsedStatus.data : undefined;
        const direction = parsedDirection.success ? parsedDirection.data : undefined;

        const andFilters: Prisma.TicketLogWhereInput[] = [
            { note: { startsWith: CALL_LOG_NOTE_PREFIX } },
        ];

        if (status) {
            andFilters.push({ note: { contains: `"status":"${status}"` } });
        }

        if (direction) {
            andFilters.push({ note: { contains: `"direction":"${direction}"` } });
        }

        if (search) {
            const searchOrFilters: Prisma.TicketLogWhereInput[] = [
                { note: { contains: search } },
                { ticket: { device: { brand: { contains: search, mode: "insensitive" } } } },
                { ticket: { device: { model: { contains: search, mode: "insensitive" } } } },
            ];
            andFilters.push({ OR: searchOrFilters });
        }

        const where: Prisma.TicketLogWhereInput = { AND: andFilters };

        const [total, logs] = await Promise.all([
            prisma.ticketLog.count({ where }),
            prisma.ticketLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    ticket: {
                        select: {
                            id: true,
                            device: {
                                select: {
                                    brand: true,
                                    model: true,
                                    account: {
                                        select: {
                                            name: true,
                                            person: {
                                                select: {
                                                    name: true,
                                                    phones: selectPrimaryPhone,
                                                },
                                            },
                                            company: {
                                                select: {
                                                    name: true,
                                                    phones: selectPrimaryPhone,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            }),
        ]);

        const items = logs
            .map((log) => {
                const parsed = decodeCallLog(log.note);
                if (!parsed) return null;
                return {
                    id: log.id,
                    ticketId: log.ticketId,
                    customerName:
                        parsed.customerName ||
                        log.ticket.device.account?.person?.name ||
                        log.ticket.device.account?.company?.name ||
                        log.ticket.device.account?.name ||
                        "Unknown",
                    phone:
                        parsed.phone ||
                        log.ticket.device.account?.person?.phones?.[0]?.phone ||
                        log.ticket.device.account?.company?.phones?.[0]?.phone ||
                        "",
                    direction: parsed.direction,
                    status: parsed.status,
                    durationSec: parsed.durationSec,
                    followUpAmount: parsed.followUpAmount,
                    note: parsed.note ?? null,
                    updatedAt: log.createdAt.toISOString(),
                };
            })
            .filter(Boolean);

        return NextResponse.json({
            items,
            pagination: {
                page,
                pageSize,
                total,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch call logs");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { data, error } = await validateRequest(req, createCallLogSchema);
        if (error) return error;

        const ticket = await prisma.ticket.findUnique({
            where: { id: data.ticketId },
            select: { id: true, status: true },
        });
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        const created = await prisma.ticketLog.create({
            data: {
                ticketId: data.ticketId,
                status: ticket.status,
                note: encodeCallLog({
                    customerName: data.customerName,
                    phone: data.phone,
                    direction: data.direction,
                    status: data.status,
                    durationSec: data.durationSec,
                    followUpAmount: data.followUpAmount,
                    note: data.note,
                }),
                visibility: "INTERNAL",
                userId: user.id,
            },
        });

        return NextResponse.json(
            {
                id: created.id,
                ticketId: created.ticketId,
                customerName: data.customerName,
                phone: data.phone,
                direction: data.direction,
                status: data.status,
                durationSec: data.durationSec,
                followUpAmount: data.followUpAmount,
                note: data.note ?? null,
                updatedAt: created.createdAt.toISOString(),
            },
            { status: 201 }
        );
    } catch (e) {
        return handleApiError(e, "Failed to create call log");
    }
}
