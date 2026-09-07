import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest, parseCursor } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { findEntryWorker } from "@/modules/repairing/lib/entryWorker";
import { autoAdvance } from "@/modules/repairing/lib/autoAdvance";
import { nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";

const createTicketSchema = z.object({
    sourceShopOrderId: z.coerce.number().int().positive().optional(),
    personId: z.coerce.number().int().positive().optional(),
    companyId: z.coerce.number().int().positive().optional(),
    billingAccountId: z.preprocess(
        (val) => (val == null || val === "") ? undefined : val,
        z.coerce.number().int().positive().optional()
    ),
    deviceType: z.string().trim().min(1, "Device type is required"),
    brand: z.string().trim().min(1, "Brand is required"),
    model: z.string().trim().min(1, "Model is required"),
    problem: z.string().trim().min(1, "Problem is required"),
    priority: z.nativeEnum(Priority).optional(),
    notes: z.string().trim().optional().or(z.literal("")),
    accessInfo: z.string().trim().optional().or(z.literal("")),
    accessories: z.string().trim().optional().or(z.literal("")),
    estimatedCost: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.coerce.number().nonnegative().optional()
    ),
    isWarranty: z.boolean().optional(),
    warrantyRef: z.string().trim().optional().or(z.literal("")),
    purchaseDate: z.string().trim().optional().or(z.literal("")),
    pipelineId: z.string().trim().optional(),
}).refine(
    (d) => Boolean(d.personId || d.companyId || d.billingAccountId || d.sourceShopOrderId),
    {
        message: "Either personId, companyId, billingAccountId, or sourceShopOrderId is required",
    }
);

// Repair-detail include used for both list + create responses.
const repairInclude = {
    repair: {
        include: {
            device: {
                include: {
                    account: {
                        select: {
                            id: true, name: true,
                            person: { select: { phones: selectPrimaryPhone } },
                            company: { select: { phones: selectPrimaryPhone } },
                        },
                    },
                },
            },
            serviceCenter: true,
        },
    },
} as const;

// Flatten the repair detail back onto the ticket so the repair UI keeps its old
// flat shape (ticket.device / ticket.warrantyStatus / …). Also exposes a flat phone
// on device.account for client compatibility.
type RepairTicketRow = { repair: Record<string, unknown> | null } & Record<string, unknown>;
function flattenRepair<T extends RepairTicketRow>(t: T) {
    const repair = (t.repair ?? {}) as Record<string, unknown>;
    const dev = repair.device as { account?: { person?: { phones?: { phone: string }[] }; company?: { phones?: { phone: string }[] } } | null } | undefined;
    const device = dev
        ? { ...dev, account: dev.account ? { ...dev.account, phone: dev.account.person?.phones?.[0]?.phone ?? dev.account.company?.phones?.[0]?.phone ?? null } : null }
        : null;
    return { ...t, ...repair, device, serviceCenter: repair.serviceCenter ?? null };
}

const TICKET_INCLUDE = {
    ...repairInclude,
    ticketStatus: { select: { label: true, color: true } },
    ticketWorker: { select: { label: true, color: true } },
    pipeline:     { select: { id: true, label: true, color: true } },
} as const;

/**
 * GET /api/tickets?pipelineId=P1
 *
 * Two modes:
 *
 * 1. **List mode (default)** — every matching ticket, bare array. This is what
 *    every caller before the Repair Tickets rework expects (`UniversalHelperSearch`,
 *    `TodaysPulse`), so it must not change shape.
 *
 * 2. **Sync mode** — `?sync=1[&cursor=<id>|&since=<iso>]`, for the Repair Tickets
 *    board, which pages 25 at a time and caches its local table (see
 *    `useTicketsDelta.ts`). Returns an ENVELOPE:
 *      { mode: "page",  rows, nextCursor, computedAt }
 *      { mode: "delta", rows, overflow, computedAt }
 *    Filters (status/priority/warranty/date/search) are server-side here — with
 *    paging, filtering the browser's array would only filter whatever page
 *    happened to be loaded.
 *
 *    There is no delete tombstone for tickets (unlike vouchers' `AuditLog`), so a
 *    hard-deleted ticket inside the client's loaded window is not chased down by
 *    a delta — the client's own `MAX_AGE_MS` cache expiry is the backstop, same
 *    as the POS product cache. Ticket hard-deletes are already rare and gated
 *    (blocked by linked vouchers / child tickets), so this is an acceptable gap
 *    rather than new tombstone plumbing.
 */
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId");
        const status     = searchParams.get("status");
        const priority   = searchParams.get("priority");
        const warranty   = searchParams.get("warranty"); // "warranty" | "non_warranty"
        const from       = searchParams.get("from");
        const to         = searchParams.get("to");
        const search     = searchParams.get("search")?.trim() ?? "";

        const searchOr: Prisma.TicketWhereInput[] = search ? [
            { repair: { device: { brand: { contains: search, mode: "insensitive" } } } },
            { repair: { device: { model: { contains: search, mode: "insensitive" } } } },
            { repair: { device: { account: { name: { contains: search, mode: "insensitive" } } } } },
            { repair: { device: { account: { person:  { phones: { some: { phone: { contains: search } } } } } } } },
            { repair: { device: { account: { company: { phones: { some: { phone: { contains: search } } } } } } } },
            ...(/^\d+$/.test(search) ? [{ id: Number(search) }] : []),
        ] : [];

        // Visibility is flat — any authenticated staff sees all tickets. Per-scope
        // read filtering (own/department/branch) was retired with the repair RBAC
        // re-wire; re-introduce a scope helper here if it comes back.
        const where: Prisma.TicketWhereInput = {
            ...(pipelineId ? { pipelineId } : {}),
            ...(status   ? { status } : {}),
            ...(priority ? { priority: priority as Priority } : {}),
            ...(warranty === "warranty"     ? { repair: { isWarranty: true } } : {}),
            ...(warranty === "non_warranty" ? { repair: { isWarranty: false } } : {}),
            ...(from || to ? {
                createdAt: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
                },
            } : {}),
            ...(searchOr.length > 0 ? { OR: searchOr } : {}),
        };

        if (!searchParams.get("sync")) {
            // ── List mode — bare array, unchanged for existing callers ──────────
            const tickets = await prisma.ticket.findMany({
                where,
                orderBy: { createdAt: "desc" },
                include: TICKET_INCLUDE,
            });
            return NextResponse.json(tickets.map(flattenRepair));
        }

        // ── Sync mode (Repair Tickets board cache) ───────────────────────────────
        const computedAt = new Date();
        const since = parseSince(searchParams.get("since"));
        const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

        if (since) {
            const MAX_DELTA_ROWS = 500;
            const changed = await prisma.ticket.findMany({
                where: { ...where, updatedAt: { gt: since } },
                orderBy,
                take: MAX_DELTA_ROWS + 1,
                include: TICKET_INCLUDE,
            });
            const overflow = changed.length > MAX_DELTA_ROWS;
            return NextResponse.json({
                mode: "delta",
                rows: overflow ? [] : changed.map(flattenRepair),
                overflow,
                computedAt: computedAt.toISOString(),
            });
        }

        const { cursor, take } = parseCursor(searchParams, { defaultLimit: 25, maxLimit: 25 });
        const rowsPlusOne = await prisma.ticket.findMany({
            where,
            orderBy,
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: TICKET_INCLUDE,
        });
        const hasMore = rowsPlusOne.length > take;
        const found = hasMore ? rowsPlusOne.slice(0, take) : rowsPlusOne;
        const nextCursor = hasMore && found.length > 0 ? found[found.length - 1].id : null;

        return NextResponse.json({
            mode: "page",
            rows: found.map(flattenRepair),
            nextCursor,
            computedAt: computedAt.toISOString(),
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch tickets");
    }
}

export async function POST(req: Request) {
    // TODO(rbac): was requirePermission(TICKETS_CREATE) — open to all staff for now.
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createTicketSchema);
        if (error) return error;
        const body = data;
        const accountId = body.billingAccountId ? Number(body.billingAccountId) : null;
        const author = await buildActorSnapshot(user.id);

        // A repair ticket = a core Ticket (GL bridge on accountId) + a TicketRepair
        // detail carrying the device it was raised for.
        const ticket = await prisma.$transaction(async (tx) => {
            let ticketNo: string | null = null;
            try {
                ticketNo = await nextRefFromSeries(tx, "REPAIR_TICKET");
            } catch {
                // fallback if series is not yet initialised
            }

            const t = await tx.ticket.create({
                data: {
                    // Which till raised this — same column and resolver as every voucher.
                    sourceCounterId: await sourceCounterId(tx),
                    priority:   body.priority ?? Priority.MEDIUM,
                    notes:      body.notes || null,
                    pipelineId: body.pipelineId || "P1",
                    accountId,
                    createdBy:  author,
                    repair: {
                        create: {
                            ticketNo,
                            device: {
                                create: {
                                    type: body.deviceType,
                                    brand: body.brand,
                                    model: body.model,
                                    problem: body.problem,
                                    ...(accountId ? { accountId } : {}),
                                },
                            },
                            accessInfo:          body.accessInfo || null,
                            accessories:         body.accessories || null,
                            estimatedCost:       body.estimatedCost ? Number(body.estimatedCost) : null,
                            isWarranty:          Boolean(body.isWarranty),
                            warrantyStatus:      body.isWarranty ? "CLAIMED" : "NONE",
                            warrantyRef:         body.warrantyRef || null,
                            purchaseDate:        body.purchaseDate ? new Date(body.purchaseDate) : null,
                            sourceOrderTicketId: body.sourceShopOrderId ?? null,
                        },
                    },
                },
                include: repairInclude,
            });

            // Log initial status
            await tx.ticketLog.create({
                data: {
                    ticketId: t.id,
                    status:   "S1",
                    note:     "Ticket created",
                    author,
                },
            });

            return t;
        });

        // Auto-enter the entry-point worker for this status (a fromWorkerId=null
        // transition whose target applies to the status), so a new ticket is immediately
        // a workable item rather than a bare status. Lowest order wins.
        const entrySub = await findEntryWorker(ticket.status);
        if (entrySub) {
            await prisma.ticket.update({ where: { id: ticket.id }, data: { workerId: entrySub.id } });
            await prisma.ticketLog.create({
                data: { ticketId: ticket.id, status: ticket.status, workerId: entrySub.id, note: `Entered: ${entrySub.label}`, author },
            });
            // If the entry worker is an Action (auto Work), run it + chain (best-effort).
            await autoAdvance(ticket.id, user.id).catch(() => { /* never blocks create */ });
        }

        return NextResponse.json({ ...flattenRepair(ticket), workerId: entrySub?.id ?? null });
    } catch (e) {
        return handleApiError(e, "Failed to create ticket");
    }
}
