import { openOrRecentlyClosedWhere } from "@/shared/lib/tickets/closedWindow";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, deltaSlice, deltaResponse, pageResponse } from "@/shared/lib/api";
import { createDealSchema } from "@/shared/lib/schemas/dealSchema";
import { getDealsPipeline } from "@/modules/deals/lib/dealsPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { phoneMatchKey } from "@/shared/lib/format";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import { ASSIGNED_POSITION_SELECT } from "@/shared/lib/api/ticketSelects";

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
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const pipeline = await getDealsPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "Deals pipeline not configured" }, { status: 503 });

        const sp = new URL(req.url).searchParams;

        // ── Sync mode (Deals board's Dexie-cached delta — see useTicketsDelta) ──
        if (sp.get("sync")) {
            const computedAt = new Date();
            const since = parseSince(sp.get("since"));
            const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "desc" }];

            if (since) {
                const { changed, overflow } = await deltaSlice((take) => prisma.ticket.findMany({
                    where: { pipelineId: pipeline.id, updatedAt: { gt: since } },
                    orderBy,
                    take,
                    select: DEAL_TICKET_SELECT,
                }));
                return deltaResponse(changed.map(flattenDeal), overflow, computedAt);
            }

            // Open tickets + those closed in the last CLOSED_TICKET_WINDOW_DAYS only.
            const all = await prisma.ticket.findMany({
                where: { pipelineId: pipeline.id, ...openOrRecentlyClosedWhere(computedAt) },
                orderBy,
                select: DEAL_TICKET_SELECT,
            });
            return pageResponse(all.map(flattenDeal), null, computedAt);
        }

        // ── List mode — bare array, for existing callers (CallFollowUpPopup, etc.) ──
        const q = sp.get("q")?.trim();
        const personId = sp.get("personId");
        const companyId = sp.get("companyId");
        const open = sp.get("open") === "1";
        // See the matching comment in /api/help — a deal captured at the counter
        // often carries only a raw phone, no linked person/company.
        const phoneKey = phoneMatchKey(sp.get("phone"));
        const personId2 = personId && /^\d+$/.test(personId) ? Number(personId) : null;
        const companyId2 = companyId && /^\d+$/.test(companyId) ? Number(companyId) : null;
        const dealOr: Record<string, unknown>[] = [];
        if (personId2 != null) dealOr.push({ personId: personId2 });
        if (companyId2 != null) dealOr.push({ companyId: companyId2 });
        if (phoneKey) dealOr.push({ phone: { endsWith: phoneKey } });
        const leads = await prisma.ticket.findMany({
            where: {
                pipelineId: pipeline.id,
                ...(dealOr.length ? { deal: { OR: dealOr } } : {}),
                ...(open ? { closedAt: null } : {}),
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
    // Open to any staff — the counter (Deal rail button, call follow-up popup)
    // and the office both create here. Visibility of the create controls is the
    // UI gate; the write itself only needs an authenticated staff session (per
    // the repo's "permissions are UI-only" posture — matches /api/help).
    const { user, response } = await requireAuth();
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
                // Which till raised this — same column and resolver as every voucher.
                sourceCounterId: await sourceCounterId(),
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
