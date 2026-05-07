import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { assertCrmStatus, getCrmPipeline } from "@/lib/crm-pipeline";
import { z } from "zod";

const leadWriteBase = z.object({
    title: z.string().trim().min(1, "Title is required").max(500),
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
});

const createLeadSchema = leadWriteBase.superRefine((data, ctx) => {
    if (data.personId != null && data.companyId != null) {
        ctx.addIssue({
            code: "custom",
            message: "Link at most one of person or company",
            path: ["personId"],
        });
    }
});

const leadInclude = {
    ticketStatus: { select: { id: true, label: true, color: true, isTerminal: true } },
    owner: { select: { id: true, name: true } },
    person: { select: { id: true, name: true } },
    company: { select: { id: true, name: true } },
    createdBy: { select: { id: true, name: true } },
} as const;

function emptyToNull<T extends string | null | undefined>(v: T): string | null | undefined {
    if (v === "") return null;
    return v;
}

export async function GET(req: Request) {
    const { response } = await requirePermission("crm:view");
    if (response) return response;

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    const status = searchParams.get("status")?.trim();
    const ownerUserId = searchParams.get("ownerUserId");
    const cursor = searchParams.get("cursor");
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));

    const where = {
        pipelineId: pipeline.id,
        ...(status ? { status } : {}),
        ...(ownerUserId && /^\d+$/.test(ownerUserId) ? { ownerUserId: Number(ownerUserId) } : {}),
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
    };

    const leads = await prisma.crmLead.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: leadInclude,
    });

    let nextCursor: number | null = null;
    let items = leads;
    if (leads.length > limit) {
        const next = leads.pop();
        nextCursor = next?.id ?? null;
        items = leads;
    }

    return NextResponse.json({ leads: items, nextCursor });
}

export async function POST(req: Request) {
    const auth = await requirePermission("crm:manage");
    if (auth.response) return auth.response;
    const { user } = auth;

    const pipeline = await getCrmPipeline(prisma);
    if (!pipeline) {
        return NextResponse.json({ error: "CRM pipeline not configured" }, { status: 503 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    const entryStatus =
        pipeline.statuses.find((s) => s.isEntryPoint) ?? pipeline.statuses[0];
    if (!entryStatus) {
        return NextResponse.json({ error: "No CRM statuses" }, { status: 503 });
    }

    const statusId = data.status ?? entryStatus.id;
    const check = await assertCrmStatus(prisma, pipeline.id, statusId);
    if (!check.ok) {
        return NextResponse.json({ error: check.message }, { status: 400 });
    }

    const [personOk, companyOk, ownerOk] = await Promise.all([
        data.personId != null
            ? prisma.person.findUnique({ where: { id: data.personId }, select: { id: true } })
            : Promise.resolve(true),
        data.companyId != null
            ? prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } })
            : Promise.resolve(true),
        data.ownerUserId != null
            ? prisma.user.findUnique({ where: { id: data.ownerUserId }, select: { id: true } })
            : Promise.resolve(true),
    ]);
    if (!personOk) return NextResponse.json({ error: "Person not found" }, { status: 400 });
    if (!companyOk) return NextResponse.json({ error: "Company not found" }, { status: 400 });
    if (!ownerOk) return NextResponse.json({ error: "Owner user not found" }, { status: 400 });

    const lead = await prisma.crmLead.create({
        data: {
            pipelineId: pipeline.id,
            status: statusId,
            title: data.title,
            contactName: emptyToNull(data.contactName) ?? null,
            phone: emptyToNull(data.phone) ?? null,
            email: emptyToNull(data.email) ?? null,
            companyName: emptyToNull(data.companyName) ?? null,
            valuePaise: data.valuePaise ?? null,
            source: emptyToNull(data.source) ?? null,
            notes: emptyToNull(data.notes) ?? null,
            personId: data.personId ?? null,
            companyId: data.companyId ?? null,
            ownerUserId: data.ownerUserId ?? null,
            createdById: user.id,
        },
        include: leadInclude,
    });

    return NextResponse.json(lead, { status: 201 });
}
