import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { Priority } from "@/generated/prisma/enums";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { findEntryWorker } from "@/modules/repairing/lib/entryWorker";
import { autoAdvance } from "@/modules/repairing/lib/autoAdvance";

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

// GET /api/tickets?pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const pipelineId = searchParams.get("pipelineId");
        // TODO(rbac): scope filtering temporarily removed — any authenticated staff
        // sees all tickets. Re-add buildTicketReadScopeWhere when RBAC is re-wired.
        const where = pipelineId ? { pipelineId } : {};

        const tickets = await prisma.ticket.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                ...repairInclude,
                ticketStatus: { select: { label: true, color: true } },
                ticketWorker: { select: { label: true, color: true } },
                pipeline:     { select: { id: true, label: true, color: true } },
            },
        });

        return NextResponse.json(tickets.map(flattenRepair));
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
        const ticket = await prisma.ticket.create({
            data: {
                priority:   body.priority ?? Priority.MEDIUM,
                notes:      body.notes || null,
                pipelineId: body.pipelineId || "P1",
                accountId,
                createdBy:  author,
                repair: {
                    create: {
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
        await prisma.ticketLog.create({
            data: {
                ticketId: ticket.id,
                status:   "S1",
                note:     "Ticket created",
                author,
            },
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
