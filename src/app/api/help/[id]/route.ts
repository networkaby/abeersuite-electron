import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { updateHelpSchema } from "@/shared/lib/schemas/helpSchema";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { HELP_TICKET_SELECT, flattenHelp } from "../route";
import { parseNumericId } from "@/shared/lib/api/parseNumericId";
import { ticketLogMedia, type LogMedia } from "@/modules/message/lib/customerMessages";

// Help ticket + its timeline (TicketLog rows — advise notes, stage moves, close).
const HELP_DETAIL_SELECT = {
    ...HELP_TICKET_SELECT,
    logs: {
        orderBy: { createdAt: "desc" as const },
        select: { id: true, kind: true, note: true, createdAt: true, author: true, data: true },
    },
} as const;

type LogRow = { id: number; kind: string; note: string | null; createdAt: Date; author: unknown };

/** A WhatsApp line's photo / file rides on its log row (see ticketLogMedia). */
function flattenHelpDetail(t: { logs: LogRow[] } & Parameters<typeof flattenHelp>[0], media: Map<number, LogMedia> = new Map()) {
    return {
        ...flattenHelp(t),
        logs: t.logs.map((l) => ({ id: l.id, kind: l.kind, note: l.note, createdAt: l.createdAt, author: l.author, media: media.get(l.id) ?? null })),
    };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const t = await prisma.ticket.findUnique({ where: { id }, select: HELP_DETAIL_SELECT });
        if (!t || !t.help) return NextResponse.json({ error: "Help ticket not found" }, { status: 404 });
        return NextResponse.json(flattenHelpDetail(t, await ticketLogMedia(id, t.logs)));
    } catch (e) {
        return handleApiError(e, "Failed to fetch help ticket");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Advise / move stage / close — any staff (the assigned team works it). UI gates
    // who sees the controls (help:edit); the write needs only an auth session.
    const { user, response } = await requireAuth();
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, updateHelpSchema);
        if (error) return error;

        const existing = await prisma.ticket.findUnique({
            where: { id },
            select: {
                id: true, pipelineId: true, status: true, assignedPositionId: true,
                ticketStatus: { select: { isTerminal: true } },
                help: { select: { ticketId: true } },
            },
        });
        if (!existing || !existing.help) return NextResponse.json({ error: "Help ticket not found" }, { status: 404 });

        // Closing with an outcome forces the ticket to the terminal (Closed) stage and
        // stamps closedAt — the outcome IS the reason it closed.
        let targetStatus = data.status;
        let closedAt: Date | null | undefined;
        const notes: string[] = [];

        if (data.outcome) {
            const closed = await prisma.ticketStatus.findFirst({
                where: { pipelineId: existing.pipelineId ?? "", isTerminal: true },
                orderBy: { order: "asc" },
                select: { id: true },
            });
            if (!closed) return NextResponse.json({ error: "Help Desk pipeline has no Closed stage" }, { status: 503 });
            targetStatus = closed.id;
            closedAt = new Date();
            notes.push(`Closed — ${data.outcome.replace(/_/g, " ").toLowerCase()}`);
        }

        // Plain stage move → validate the target belongs to this pipeline; stamp/clear
        // closedAt. Moving a CLOSED ticket back to a working stage = a reopen, which
        // also clears its outcome.
        let reopening = false;
        if (targetStatus && targetStatus !== existing.status && !data.outcome) {
            const target = await prisma.ticketStatus.findUnique({
                where: { id: targetStatus },
                select: { label: true, isTerminal: true, pipelineId: true },
            });
            if (!target || target.pipelineId !== existing.pipelineId) {
                return NextResponse.json({ error: "Invalid stage for Help Desk pipeline" }, { status: 400 });
            }
            closedAt = target.isTerminal ? new Date() : null;
            reopening = Boolean(existing.ticketStatus?.isTerminal) && !target.isTerminal;
            notes.push(reopening ? "Reopened" : `Moved to "${target.label}"`);
        }

        // Position (owner) change.
        const positionChanging =
            data.assignedPositionId !== undefined && data.assignedPositionId !== existing.assignedPositionId;
        if (positionChanging && data.assignedPositionId) {
            const pos = await prisma.position.findUnique({ where: { id: data.assignedPositionId }, select: { title: true } });
            if (!pos) return NextResponse.json({ error: "Assigned position not found" }, { status: 400 });
            notes.push(`Assigned to ${pos.title}`);
        } else if (positionChanging) {
            notes.push("Unassigned");
        }

        // Validate linked customer (if being set).
        if (data.personId != null) {
            const p = await prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } });
            if (!p) return NextResponse.json({ error: "Linked person not found" }, { status: 400 });
        }
        if (data.companyId != null) {
            const c = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
            if (!c) return NextResponse.json({ error: "Linked company not found" }, { status: 400 });
        }

        // Help-detail fields live on TicketHelp; subject/inquiryType also mirror to the core row.
        const helpData = {
            ...(data.subject !== undefined ? { subject: data.subject } : {}),
            ...(data.inquiryType !== undefined ? { inquiryType: data.inquiryType } : {}),
            ...(data.contactName !== undefined ? { contactName: data.contactName ?? null } : {}),
            ...(data.phone !== undefined ? { phone: data.phone ?? null } : {}),
            ...(data.email !== undefined ? { email: data.email ?? null } : {}),
            ...(data.personId !== undefined ? { personId: data.personId ?? null } : {}),
            ...(data.companyId !== undefined ? { companyId: data.companyId ?? null } : {}),
            ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
            ...(reopening ? { outcome: null } : {}),
        };

        const t = await prisma.ticket.update({
            where: { id },
            data: {
                ...(data.subject !== undefined ? { title: data.subject } : {}),
                ...(data.inquiryType !== undefined ? { category: data.inquiryType } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.assignedPositionId !== undefined ? { assignedPositionId: data.assignedPositionId ?? null } : {}),
                ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
                ...(targetStatus !== undefined ? { status: targetStatus } : {}),
                ...(closedAt !== undefined ? { closedAt } : {}),
                ...(Object.keys(helpData).length ? { help: { update: helpData } } : {}),
            },
            select: HELP_TICKET_SELECT,
        });

        if (notes.length > 0 || data.logNote) {
            const author = await buildActorSnapshot(user.id);
            if (notes.length > 0) {
                await prisma.ticketLog.createMany({
                    data: notes.map((note) => ({ ticketId: id, author, note, kind: "SYSTEM" as const })),
                });
            }
            // A freeform advise note from the team.
            if (data.logNote) {
                await prisma.ticketLog.create({
                    data: { ticketId: id, author, note: data.logNote, kind: "NOTE" as const },
                });
            }
        }

        return NextResponse.json(flattenHelp(t));
    } catch (e) {
        return handleApiError(e, "Failed to update help ticket");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    // Delete needs the delete rung, not just the module's sidebar link.
    const { response } = await requirePermission(PERMISSIONS.HELP_DELETE);
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const existing = await prisma.ticket.findUnique({ where: { id }, select: { id: true, help: { select: { ticketId: true } } } });
        if (!existing || !existing.help) return NextResponse.json({ error: "Help ticket not found" }, { status: 404 });
        await prisma.ticket.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete help ticket");
    }
}
