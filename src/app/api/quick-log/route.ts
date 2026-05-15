/**
 * POST /api/quick-log
 *
 * Universal quick-intake endpoint — available to every authenticated staff
 * member (no extra permission required). Logs a new CrmLead into any pipeline:
 *
 *   pipelineId = "P6" → Sales query   (CRM)
 *   pipelineId = "P2" → Customer problem (Helpdesk / Customer Support)
 *   pipelineId = "P4" → Internal request (Administration)
 *
 * The log is stamped with the calling user's id as createdById.
 * Downstream modules (CRM, Helpdesk, Administration) will show and process
 * these items once their own UIs are built.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest } from "@/shared/lib/api";

// Allowed pipeline ids for quick-log
const ALLOWED_PIPELINE_IDS = ["P2", "P4", "P6"] as const;

const quickLogSchema = z.object({
    pipelineId: z.enum(ALLOWED_PIPELINE_IDS),
    title: z.string().trim().min(1, "Title is required").max(500),
    contactName: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    source: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(20000).optional().nullable(),
    personId: z.coerce.number().int().positive().optional().nullable(),
    companyId: z.coerce.number().int().positive().optional().nullable(),
});

export async function POST(req: Request) {
    // Any authenticated staff member can log — no extra permission gate.
    const auth = await requireAuth();
    if (auth.response) return auth.response;
    const { user } = auth;

    const { data, error } = await validateRequest(req, quickLogSchema);
    if (error) return error;
    const { pipelineId, title, contactName, phone, source, notes, personId, companyId } = data;

    // Resolve the entry-point status for the target pipeline.
    const entryStatus = await prisma.ticketStatus.findFirst({
        where: { pipelineId, isEntryPoint: true },
        select: { id: true },
        orderBy: { order: "asc" },
    });
    if (!entryStatus) {
        return NextResponse.json(
            { error: `No entry-point status found for pipeline ${pipelineId}` },
            { status: 503 },
        );
    }

    // Optionally verify person / company exist (skip if not provided).
    if (personId != null) {
        const ok = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
        if (!ok) return NextResponse.json({ error: "Person not found" }, { status: 400 });
    }
    if (companyId != null) {
        const ok = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
        if (!ok) return NextResponse.json({ error: "Company not found" }, { status: 400 });
    }

    const lead = await prisma.crmLead.create({
        data: {
            pipelineId,
            status: entryStatus.id,
            title,
            contactName: contactName || null,
            phone: phone || null,
            source: source || null,
            notes: notes || null,
            personId: personId ?? null,
            companyId: companyId ?? null,
            createdById: user.id,
        },
        select: {
            id: true,
            pipelineId: true,
            status: true,
            title: true,
            contactName: true,
            phone: true,
            createdAt: true,
        },
    });

    return NextResponse.json(lead, { status: 201 });
}
