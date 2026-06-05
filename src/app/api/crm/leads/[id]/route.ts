import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { updateLeadSchema } from "@/shared/lib/schemas/crmSchema";
import { assertCrmStatus } from "@/modules/customer/lib/crmPipeline";
import { buildActorSnapshot } from "@/shared/lib/auth/actorSnapshot";
import { LEAD_SELECT } from "../route";

const LEAD_DETAIL_SELECT = {
    ...LEAD_SELECT,
    notes: true,
    activities: {
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, body: true, dueAt: true, doneAt: true, createdAt: true, author: true },
    },
} as const;

function parseId(raw: string): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.CRM_VIEW);
    if (response) return response;
    const id = parseId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const lead = await prisma.crmLead.findUnique({ where: { id }, select: LEAD_DETAIL_SELECT });
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
        return NextResponse.json(lead);
    } catch (e) {
        return handleApiError(e, "Failed to fetch lead");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.CRM_MANAGE);
    if (response) return response;
    const id = parseId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { data, error } = await validateRequest(req, updateLeadSchema);
        if (error) return error;

        const existing = await prisma.crmLead.findUnique({
            where: { id },
            select: { id: true, pipelineId: true, status: true, assignedPositionId: true },
        });
        if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

        // Stage change → validate target belongs to the CRM pipeline; stamp closedAt
        // on a terminal stage (Won / Lost), clear it otherwise.
        let completedChange: { closedAt: Date | null } | undefined;
        let statusNote: string | undefined;
        if (data.status && data.status !== existing.status) {
            const check = await assertCrmStatus(prisma, existing.pipelineId, data.status);
            if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
            const target = await prisma.ticketStatus.findUnique({
                where: { id: data.status },
                select: { label: true, isTerminal: true },
            });
            completedChange = { closedAt: target?.isTerminal ? new Date() : null };
            statusNote = `Moved to "${target?.label ?? data.status}"`;
        }

        // Position (owner) change → resolve target seat title for the activity note.
        const positionChanging =
            data.assignedPositionId !== undefined && data.assignedPositionId !== existing.assignedPositionId;
        let newPositionTitle: string | null = null;
        if (positionChanging && data.assignedPositionId) {
            const pos = await prisma.position.findUnique({
                where: { id: data.assignedPositionId },
                select: { title: true },
            });
            if (!pos) return NextResponse.json({ error: "Assigned position not found" }, { status: 400 });
            newPositionTitle = pos.title;
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

        const lead = await prisma.crmLead.update({
            where: { id },
            data: {
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.contactName !== undefined ? { contactName: data.contactName ?? null } : {}),
                ...(data.phone !== undefined ? { phone: data.phone ?? null } : {}),
                ...(data.email !== undefined ? { email: data.email ?? null } : {}),
                ...(data.companyName !== undefined ? { companyName: data.companyName ?? null } : {}),
                ...(data.personId !== undefined ? { personId: data.personId ?? null } : {}),
                ...(data.companyId !== undefined ? { companyId: data.companyId ?? null } : {}),
                ...(data.valuePaise !== undefined ? { valuePaise: data.valuePaise ?? null } : {}),
                ...(data.source !== undefined ? { source: data.source ?? null } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.assignedPositionId !== undefined ? { assignedPositionId: data.assignedPositionId ?? null } : {}),
                ...(data.nextFollowUpAt !== undefined ? { nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null } : {}),
                ...(data.lostReason !== undefined ? { lostReason: data.lostReason ?? null } : {}),
                ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
                ...(data.status !== undefined ? { status: data.status } : {}),
                ...(completedChange !== undefined ? completedChange : {}),
            },
            select: LEAD_SELECT,
        });

        // SYSTEM activity entries for stage / owner changes.
        const notes: string[] = [];
        if (statusNote) notes.push(statusNote);
        if (positionChanging) notes.push(data.assignedPositionId ? `Assigned to ${newPositionTitle}` : "Unassigned");
        if (notes.length > 0) {
            const author = await buildActorSnapshot(user.id);
            await prisma.crmLeadActivity.createMany({
                data: notes.map((body) => ({ leadId: id, author, body, kind: "SYSTEM" as const })),
            });
        }

        return NextResponse.json(lead);
    } catch (e) {
        return handleApiError(e, "Failed to update lead");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.CRM_MANAGE);
    if (response) return response;
    const id = parseId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const existing = await prisma.crmLead.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
        await prisma.crmLead.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete lead");
    }
}
