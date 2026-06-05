import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { createLeadSchema } from "@/shared/lib/schemas/crmSchema";
import { getCrmPipeline, assertCrmStatus } from "@/modules/customer/lib/crmPipeline";
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

export const LEAD_SELECT = {
    id: true,
    pipelineId: true,
    status: true,
    title: true,
    contactName: true,
    phone: true,
    email: true,
    companyName: true,
    personId: true,
    companyId: true,
    valuePaise: true,
    source: true,
    priority: true,
    nextFollowUpAt: true,
    closedAt: true,
    lostReason: true,
    order: true,
    assignedPositionId: true,
    createdBy: true, // JSON actor snapshot
    createdAt: true,
    updatedAt: true,
    ticketStatus: { select: { id: true, label: true, color: true, order: true, isTerminal: true } },
    assignedPosition: ASSIGNED_POSITION_SELECT,
    person: { select: { id: true, name: true } },
    company: { select: { id: true, name: true } },
    _count: { select: { activities: true } },
} as const;

export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.CRM_VIEW);
    if (response) return response;
    try {
        const pipeline = await getCrmPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });

        const q = new URL(req.url).searchParams.get("q")?.trim();
        const leads = await prisma.crmLead.findMany({
            where: {
                pipelineId: pipeline.id,
                ...(q
                    ? {
                          OR: [
                              { title: { contains: q, mode: "insensitive" as const } },
                              { contactName: { contains: q, mode: "insensitive" as const } },
                              { companyName: { contains: q, mode: "insensitive" as const } },
                              { email: { contains: q, mode: "insensitive" as const } },
                              { phone: { contains: q } },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ order: "asc" }, { createdAt: "desc" }],
            select: LEAD_SELECT,
        });
        return NextResponse.json(leads);
    } catch (e) {
        return handleApiError(e, "Failed to fetch leads");
    }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.CRM_MANAGE);
    if (response) return response;
    try {
        const pipeline = await getCrmPipeline(prisma);
        if (!pipeline) return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });

        const { data, error } = await validateRequest(req, createLeadSchema);
        if (error) return error;

        const entry = pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
        if (!entry) return NextResponse.json({ error: "CRM pipeline has no stages" }, { status: 503 });

        // Validate linked customer exists (if provided).
        if (data.personId != null) {
            const p = await prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } });
            if (!p) return NextResponse.json({ error: "Linked person not found" }, { status: 400 });
        }
        if (data.companyId != null) {
            const c = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
            if (!c) return NextResponse.json({ error: "Linked company not found" }, { status: 400 });
        }

        const lead = await prisma.crmLead.create({
            data: {
                pipelineId: pipeline.id,
                status: entry.id,
                title: data.title,
                contactName: data.contactName ?? null,
                phone: data.phone ?? null,
                email: data.email ?? null,
                companyName: data.companyName ?? null,
                personId: data.personId ?? null,
                companyId: data.companyId ?? null,
                valuePaise: data.valuePaise ?? null,
                source: data.source ?? null,
                priority: data.priority ?? "MEDIUM",
                nextFollowUpAt: data.nextFollowUpAt ? new Date(data.nextFollowUpAt) : null,
                assignedPositionId: data.assignedPositionId ?? null,
                notes: data.notes ?? null,
                createdBy: await buildActorSnapshot(user.id),
            },
            select: LEAD_SELECT,
        });
        return NextResponse.json(lead, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create lead");
    }
}
