import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

const subStatusSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().min(1).optional(),
    group: z.string().trim().optional().nullable(),
    groupId: z.string().trim().optional().nullable(),
    order: z.coerce.number().int().nonnegative().optional(),
    applicableStatusIds: z.array(z.string().trim()).optional(),
    allowedRoles: z.array(z.string().trim()).optional(),
    notifyRoles: z.array(z.string().trim()).optional(),
    triggerMap: z.record(z.string(), z.string()).optional(),
    actionLabel: z.string().optional().nullable(),
    warrantyScope: z.enum(["any", "warranty_only", "non_warranty_only"]).optional(),
    handoffRole: z.string().optional().nullable(),
    autoRevertOnClear: z.boolean().optional(),
    pipelineId: z.string().optional().nullable(),
    isEntryPoint: z.boolean().optional(),
});

// GET /api/sub-statuses?statusId=S3&pipelineId=P1
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const statusId = searchParams.get("statusId");
        const pipelineId = searchParams.get("pipelineId");

        const [all, entryPoints] = await Promise.all([
            prisma.ticketSubStatus.findMany({
                where: pipelineId ? { pipelineId } : undefined,
                orderBy: { order: "asc" },
                include: {
                    fromTransitions: {
                        include: { to: { select: { id: true, label: true, color: true } } },
                    },
                },
            }),
            prisma.subStatusTransition.findMany({
                where: { fromSubStatusId: null },
                select: { toSubStatusId: true },
            }),
        ]);

        const entrySet = new Set(entryPoints.map((e) => e.toSubStatusId));

        const result = (statusId ? all.filter((ss) => ss.applicableStatusIds.includes(statusId)) : all)
            .map((ss) => ({ ...ss, isEntryPoint: entrySet.has(ss.id) }));

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch sub-statuses" }, { status: 500 });
    }
}

// POST /api/sub-statuses
export async function POST(req: Request) {
    const { response } = await requirePermission("settings:statuses");
    if (response) return response;
    try {
        const parsed = subStatusSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid sub-status payload" }, { status: 400 });
        }
        const body = parsed.data;

        const existing = await prisma.ticketSubStatus.findMany({ select: { id: true } });
        const maxN = existing.reduce((max, s) => {
            const n = parseInt(s.id.replace(/\D/g, ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `SS${maxN + 1}`;

        const created = await prisma.ticketSubStatus.create({
            data: {
                id: newId,
                label: body.label,
                color: body.color ?? "bg-gray-100 text-gray-600",
                group: body.group ?? body.groupId ?? "",
                groupId: body.groupId ?? body.group ?? null,
                order: body.order ?? maxN + 1,
                applicableStatusIds: body.applicableStatusIds ?? [],
                allowedRoles: body.allowedRoles ?? [],
                notifyRoles: body.notifyRoles ?? [],
                triggerMap:         body.triggerMap ?? {},
                actionLabel:        body.actionLabel ?? null,
                warrantyScope:      body.warrantyScope ?? "any",
                handoffRole:        body.handoffRole ?? null,
                autoRevertOnClear:  body.autoRevertOnClear ?? true,
                pipelineId:         body.pipelineId ?? null,
            },
        });

        if (body.isEntryPoint) {
            await prisma.subStatusTransition.create({
                data: { fromSubStatusId: null, toSubStatusId: newId },
            });
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to create sub-status" }, { status: 500 });
    }
}
