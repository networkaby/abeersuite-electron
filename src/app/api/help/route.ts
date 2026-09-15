import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, deltaSlice, deltaResponse, pageResponse } from "@/shared/lib/api";
import { createHelpSchema } from "@/shared/lib/schemas/helpSchema";
import { getHelpPipeline } from "@/modules/help/lib/helpPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { phoneMatchKey } from "@/shared/lib/format";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { sourceCounterId } from "@/shared/lib/counter/sourceCounter";
import { ASSIGNED_POSITION_SELECT } from "@/shared/lib/api/ticketSelects";

// A help ticket is a Ticket (flavour "help") + a TicketHelp detail. We query the
// Ticket and flatten the detail back onto it at the boundary so the Help UI has a
// single flat shape.
export const HELP_TICKET_SELECT = {
    id: true,
    pipelineId: true,
    status: true,
    title: true,       // ← subject (mirrored)
    category: true,    // ← inquiryType (mirrored)
    notes: true,
    priority: true,
    closedAt: true,
    sortOrder: true,   // → order
    assignedPositionId: true,
    createdBy: true,   // JSON actor snapshot
    createdAt: true,
    updatedAt: true,
    ticketStatus: { select: { id: true, label: true, color: true, order: true, isTerminal: true } },
    assignedPosition: ASSIGNED_POSITION_SELECT,
    help: {
        select: {
            contactName: true, phone: true, email: true,
            personId: true, companyId: true, inquiryType: true, subject: true,
            outcome: true,
            person: { select: { id: true, name: true } },
            company: { select: { id: true, name: true } },
        },
    },
    _count: { select: { logs: true } },
} as const;

type HelpTicketRow = {
    id: number; pipelineId: string | null; status: string; title: string | null;
    category: string | null; notes: string | null; priority: string; closedAt: Date | null;
    sortOrder: number; assignedPositionId: string | null; assignedPosition: unknown;
    createdBy: unknown; createdAt: Date; updatedAt: Date; ticketStatus: unknown;
    help: {
        contactName: string | null; phone: string | null; email: string | null;
        personId: number | null; companyId: number | null; inquiryType: string | null;
        subject: string | null; outcome: string | null;
        person: unknown; company: unknown;
    } | null;
    _count: { logs: number };
};

/** Flatten a help Ticket to the flat shape the Help UI expects. */
export function flattenHelp(t: HelpTicketRow) {
    const h = t.help;
    return {
        id: t.id, pipelineId: t.pipelineId, status: t.status,
        subject: h?.subject ?? t.title, inquiryType: h?.inquiryType ?? t.category,
        notes: t.notes, priority: t.priority, closedAt: t.closedAt, order: t.sortOrder,
        assignedPositionId: t.assignedPositionId, assignedPosition: t.assignedPosition,
        createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
        ticketStatus: t.ticketStatus,
        contactName: h?.contactName ?? null, phone: h?.phone ?? null, email: h?.email ?? null,
        personId: h?.personId ?? null, companyId: h?.companyId ?? null,
        outcome: h?.outcome ?? null,
        person: h?.person ?? null, company: h?.company ?? null,
        _count: { logs: t._count.logs },
    };
}

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const pipeline = await getHelpPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "Help Desk pipeline not configured" }, { status: 503 });

        const sp = new URL(req.url).searchParams;

        // ── Sync mode (Help board's Dexie-cached delta — see useTicketsDelta) ──
        if (sp.get("sync")) {
            const computedAt = new Date();
            const since = parseSince(sp.get("since"));
            const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "desc" }];

            if (since) {
                const { changed, overflow } = await deltaSlice((take) => prisma.ticket.findMany({
                    where: { pipelineId: pipeline.id, updatedAt: { gt: since } },
                    orderBy,
                    take,
                    select: HELP_TICKET_SELECT,
                }));
                return deltaResponse(changed.map(flattenHelp), overflow, computedAt);
            }

            const all = await prisma.ticket.findMany({
                where: { pipelineId: pipeline.id },
                orderBy,
                select: HELP_TICKET_SELECT,
            });
            return pageResponse(all.map(flattenHelp), null, computedAt);
        }

        // ── List mode — bare array, for existing callers (CallFollowUpPopup, etc.) ──
        const q = sp.get("q")?.trim();
        const personId = sp.get("personId");
        const companyId = sp.get("companyId");
        const open = sp.get("open") === "1";
        // Matches on the ticket's OWN phone field too, not just a linked
        // person/company — most counter-captured help tickets carry only a raw
        // phone (HelpQuickForm doesn't require a full Person record), so a
        // customer-id filter alone would miss them. Last-10-digit match, same
        // normalisation the Call Log's own reverse-lookup uses, so "+91 98765
        // 43210" on one side and "098765-43210" on the other still match.
        const phoneKey = phoneMatchKey(sp.get("phone"));
        const personId2 = personId && /^\d+$/.test(personId) ? Number(personId) : null;
        const companyId2 = companyId && /^\d+$/.test(companyId) ? Number(companyId) : null;
        const helpOr: Record<string, unknown>[] = [];
        if (personId2 != null) helpOr.push({ personId: personId2 });
        if (companyId2 != null) helpOr.push({ companyId: companyId2 });
        if (phoneKey) helpOr.push({ phone: { endsWith: phoneKey } });
        const tickets = await prisma.ticket.findMany({
            where: {
                pipelineId: pipeline.id,
                ...(helpOr.length ? { help: { OR: helpOr } } : {}),
                ...(open ? { closedAt: null } : {}),
                ...(q
                    ? {
                          OR: [
                              { title: { contains: q, mode: "insensitive" as const } },
                              { help: { contactName: { contains: q, mode: "insensitive" as const } } },
                              { help: { phone: { contains: q } } },
                              { help: { person: { name: { contains: q, mode: "insensitive" as const } } } },
                              { help: { company: { name: { contains: q, mode: "insensitive" as const } } } },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
            select: HELP_TICKET_SELECT,
        });
        return NextResponse.json(tickets.map(flattenHelp));
    } catch (e) {
        return handleApiError(e, "Failed to fetch help tickets");
    }
}

export async function POST(req: Request) {
    // Open to any staff — the counter (Enquiry rail) and the office both create
    // here. Visibility of the create controls is the UI gate (help:create); the
    // write itself only needs an authenticated staff session (per the repo's
    // "permissions are UI-only" posture, matching /api/tickets).
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const pipeline = await getHelpPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "Help Desk pipeline not configured" }, { status: 503 });

        const { data, error } = await validateRequest(req, createHelpSchema);
        if (error) return error;

        const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
        if (!entry) return NextResponse.json({ error: "Help Desk pipeline has no stages" }, { status: 503 });

        // Validate linked customer exists (if provided).
        if (data.personId != null) {
            const p = await prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } });
            if (!p) return NextResponse.json({ error: "Linked person not found" }, { status: 400 });
        }
        if (data.companyId != null) {
            const c = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
            if (!c) return NextResponse.json({ error: "Linked company not found" }, { status: 400 });
        }

        const author = await buildActorSnapshot(user.id);
        const ticket = await prisma.ticket.create({
            data: {
                // Which till raised this — same column and resolver as every voucher.
                sourceCounterId: await sourceCounterId(),
                pipelineId: pipeline.id,
                status: entry.id,
                title: data.subject ?? null,  // subject mirrored onto the core row (optional)
                category: data.inquiryType,   // inquiry type mirrored as the light tag
                priority: data.priority ?? "MEDIUM",
                assignedPositionId: data.assignedPositionId ?? null,
                notes: data.notes ?? null,
                createdBy: author,
                help: {
                    create: {
                        contactName: data.contactName ?? null,
                        phone: data.phone ?? null,
                        email: data.email ?? null,
                        personId: data.personId ?? null,
                        companyId: data.companyId ?? null,
                        inquiryType: data.inquiryType,
                        subject: data.subject ?? null,
                    },
                },
            },
            select: HELP_TICKET_SELECT,
        });
        await prisma.ticketLog.create({
            data: { ticketId: ticket.id, status: ticket.status, note: "Help ticket logged", author },
        });
        return NextResponse.json(flattenHelp(ticket), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create help ticket");
    }
}
