import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { assertCrmStatus, getCrmPipeline } from "@/modules/customer/lib/crmPipeline";
import { z } from "zod";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const leadInclude = {
    ticketStatus: { select: { id: true, label: true, color: true, isTerminal: true } },
    owner: { select: { id: true, name: true } },
    person: { select: { id: true, name: true } },
    company: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
} as const;

const patchLeadSchema = z
    .object({
        title: z.string().trim().min(1).max(500).optional(),
        contactName: z.string().trim().max(200).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        email: z
            .string()
            .trim()
            .max(320)
            .optional()
            .nullable()
            .refine((v) => !v || v === "" || z.string().email().safeParse(v).success, "Invalid email"),
        companyName: z.string().trim().max(200).optional().nullable(),
        valuePaise: z.coerce.number().int().positive().optional().nullable(),
        source: z.string().trim().max(80).optional().nullable(),
        notes: z.string().trim().max(20000).optional().nullable(),
        personId: z.coerce.number().int().positive().optional().nullable(),
        companyId: z.coerce.number().int().positive().optional().nullable(),
        ownerUserId: z.coerce.number().int().positive().optional().nullable(),
        status: z.string().trim().min(1).optional(),
    })
    .superRefine((data, ctx) => {
        if (data.personId != null && data.companyId != null) {
            ctx.addIssue({
                code: "custom",
                message: "Link at most one of person or company",
                path: ["personId"],
            });
        }
    });

function emptyToNull<T extends string | null | undefined>(v: T): string | null | undefined {
    if (v === "") return null;
    return v;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.CRM_VIEW);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id) || id < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });
    }

    const lead = await prisma.crmLead.findFirst({
        where: { id, pipelineId: pipeline.id },
        include: leadInclude,
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(lead);
}

export async function PATCH(req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.CRM_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id) || id < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });
    }

    const existing = await prisma.crmLead.findFirst({
        where: { id, pipelineId: pipeline.id },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = patchLeadSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    if (data.status != null) {
        const check = await assertCrmStatus(prisma, pipeline.id, data.status);
        if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
    }

    if (data.personId !== undefined && data.personId != null) {
        const p = await prisma.person.findUnique({ where: { id: data.personId } });
        if (!p) return NextResponse.json({ error: "Person not found" }, { status: 400 });
    }
    if (data.companyId !== undefined && data.companyId != null) {
        const c = await prisma.company.findUnique({ where: { id: data.companyId } });
        if (!c) return NextResponse.json({ error: "Company not found" }, { status: 400 });
    }
    if (data.ownerUserId !== undefined && data.ownerUserId != null) {
        const u = await prisma.user.findUnique({ where: { id: data.ownerUserId } });
        if (!u) return NextResponse.json({ error: "Owner user not found" }, { status: 400 });
    }

    const personId =
        data.personId === undefined ? undefined : data.personId === null ? null : data.personId;
    const companyId =
        data.companyId === undefined ? undefined : data.companyId === null ? null : data.companyId;
    if (personId != null && companyId != null) {
        return NextResponse.json({ error: "Link at most one of person or company" }, { status: 400 });
    }

    const lead = await prisma.crmLead.update({
        where: { id },
        data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.contactName !== undefined ? { contactName: emptyToNull(data.contactName) ?? null } : {}),
            ...(data.phone !== undefined ? { phone: emptyToNull(data.phone) ?? null } : {}),
            ...(data.email !== undefined ? { email: emptyToNull(data.email) ?? null } : {}),
            ...(data.companyName !== undefined ? { companyName: emptyToNull(data.companyName) ?? null } : {}),
            ...(data.valuePaise !== undefined ? { valuePaise: data.valuePaise } : {}),
            ...(data.source !== undefined ? { source: emptyToNull(data.source) ?? null } : {}),
            ...(data.notes !== undefined ? { notes: emptyToNull(data.notes) ?? null } : {}),
            ...(data.personId !== undefined ? { personId } : {}),
            ...(data.companyId !== undefined ? { companyId } : {}),
            ...(data.ownerUserId !== undefined
                ? { ownerUserId: data.ownerUserId === null ? null : data.ownerUserId }
                : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
        },
        include: leadInclude,
    });

    return NextResponse.json(lead);
}

export async function DELETE(_req: Request, { params }: Params) {
    const { response } = await requirePermission(PERMISSIONS.CRM_MANAGE);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id) || id < 1) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });
    }

    const existing = await prisma.crmLead.findFirst({
        where: { id, pipelineId: pipeline.id },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.crmLead.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
