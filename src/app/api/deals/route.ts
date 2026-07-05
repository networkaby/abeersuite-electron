import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createDealSchema } from "@/shared/lib/schemas/dealSchema";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";

/** Position the lead is assigned to + its current live holders. */
const ASSIGNED_POSITION_SELECT = {
    select: {
        id: true,
        title: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
        holders: { select: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } } },
    },
} as const;

// A deal is a Ticket (flavour "deal") + a TicketDeal detail. We query the Ticket and
// flatten the detail back to the old flat Deal shape at the boundary (below), so the
// deals UI keeps its existing contract.
export const DEAL_TICKET_SELECT = {
    id: true,
    pipelineId: true,
    status: true,
    title: true,
    priority: true,
    closedAt: true,
    dueAt: true,       // → nextFollowUpAt
    sortOrder: true,   // → order
    assignedPositionId: true,
    createdBy: true,   // JSON actor snapshot
    createdAt: true,
    updatedAt: true,
    ticketStatus: { select: { id: true, label: true, color: true, order: true, isTerminal: true } },
    assignedPosition: ASSIGNED_POSITION_SELECT,
    deal: {
        select: {
            contactName: true, phone: true, email: true, companyName: true,
            personId: true, companyId: true, valuePaise: true, source: true, lostReason: true,
            person: { select: { id: true, name: true } },
            company: { select: { id: true, name: true } },
        },
    },
    _count: { select: { logs: true } },
} as const;

type DealTicketRow = {
    id: number; pipelineId: string | null; status: string; title: string | null;
    priority: string; closedAt: Date | null; dueAt: Date | null; sortOrder: number;
    assignedPositionId: string | null; assignedPosition: unknown; createdBy: unknown;
    createdAt: Date; updatedAt: Date; ticketStatus: unknown;
    deal: {
        contactName: string | null; phone: string | null; email: string | null; companyName: string | null;
        personId: number | null; companyId: number | null; valuePaise: number | null; source: string | null;
        lostReason: string | null; person: unknown; company: unknown;
    } | null;
    _count: { logs: number };
};

// Flatten a deal Ticket to the flat Deal shape the deals UI expects.
export function flattenDeal(t: DealTicketRow) {
    const d = t.deal;
    return {
        id: t.id, pipelineId: t.pipelineId, status: t.status, title: t.title,
        priority: t.priority, closedAt: t.closedAt,
        nextFollowUpAt: t.dueAt, order: t.sortOrder,
        assignedPositionId: t.assignedPositionId, assignedPosition: t.assignedPosition,
        createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
        ticketStatus: t.ticketStatus,
        contactName: d?.contactName ?? null, phone: d?.phone ?? null, email: d?.email ?? null,
        companyName: d?.companyName ?? null, personId: d?.personId ?? null, companyId: d?.companyId ?? null,
        valuePaise: d?.valuePaise ?? null, source: d?.source ?? null, lostReason: d?.lostReason ?? null,
        person: d?.person ?? null, company: d?.company ?? null,
        _count: { activities: t._count.logs },
    };
}

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.DEALS_VIEW);
    if (response) return response;
    try {
        const pipeline = await getDealsPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "Deals pipeline not configured" }, { status: 503 });

        const sp = new URL(req.url).searchParams;
        const q = sp.get("q")?.trim();
        const personId = sp.get("personId");
        const companyId = sp.get("companyId");
        const dealFilter: { personId?: number; companyId?: number } = {};
        if (personId && /^\d+$/.test(personId)) dealFilter.personId = Number(personId);
        if (companyId && /^\d+$/.test(companyId)) dealFilter.companyId = Number(companyId);
        const leads = await prisma.ticket.findMany({
            where: {
                pipelineId: pipeline.id,
                ...(Object.keys(dealFilter).length ? { deal: dealFilter } : {}),
                ...(q
                    ? {
                          OR: [
                              { title: { contains: q, mode: "insensitive" as const } },
                              { deal: { contactName: { contains: q, mode: "insensitive" as const } } },
                              { deal: { companyName: { contains: q, mode: "insensitive" as const } } },
                              { deal: { email: { contains: q, mode: "insensitive" as const } } },
                              { deal: { phone: { contains: q } } },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
            select: DEAL_TICKET_SELECT,
        });
        return NextResponse.json(leads.map(flattenDeal));
    } catch (e) {
        return handleApiError(e, "Failed to fetch leads");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.DEALS_MANAGE);
    if (response) return response;
    try {
        const pipeline = await getDealsPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "Deals pipeline not configured" }, { status: 503 });

        const { data, error } = await validateRequest(req, createDealSchema);
        if (error) return error;

        const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
        if (!entry) return NextResponse.json({ error: "Deals pipeline has no stages" }, { status: 503 });

        // Validate linked customer exists (if provided).
        if (data.personId != null) {
            const p = await prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } });
            if (!p) return NextResponse.json({ error: "Linked person not found" }, { status: 400 });
        }
        if (data.companyId != null) {
            const c = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
            if (!c) return NextResponse.json({ error: "Linked company not found" }, { status: 400 });
        }

        const lead = await prisma.ticket.create({
            data: {
                pipelineId: pipeline.id,
                status: entry.id,
                title: data.title,
                priority: data.priority ?? "MEDIUM",
                dueAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
                assignedPositionId: data.assignedPositionId ?? null,
                notes: data.notes ?? null,
                createdBy: await buildActorSnapshot(user.id),
                deal: {
                    create: {
                        contactName: data.contactName ?? null,
                        phone: data.phone ?? null,
                        email: data.email ?? null,
                        companyName: data.companyName ?? null,
                        personId: data.personId ?? null,
                        companyId: data.companyId ?? null,
                        valuePaise: data.valuePaise ?? null,
                        source: data.source ?? null,
                    },
                },
            },
            select: DEAL_TICKET_SELECT,
        });
        return NextResponse.json(flattenDeal(lead), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create lead");
    }
}
