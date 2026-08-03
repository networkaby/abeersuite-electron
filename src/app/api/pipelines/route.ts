import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId } from "@/shared/lib/api";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { revalidateTag } from "next/cache";
import { NAV_MASTERS_TAG } from "@/shared/lib/nav/navCounts";

const pipelineSchema = z.object({
    name: z.string().trim().min(1, "Name is required").regex(/^[a-z0-9_-]+$/, "Name must be lowercase letters, numbers, hyphens or underscores"),
    label: z.string().trim().min(1, "Label is required"),
    description: z.string().optional().nullable(),
    color: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const pipelines = await prisma.pipeline.findMany({
            orderBy: { order: "asc" },
            include: {
                _count: { select: { statuses: true, tickets: true } },
            },
        });
        return NextResponse.json(pipelines);
    } catch (e) {
        return handleApiError(e, "Failed to fetch pipelines");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, pipelineSchema);
        if (error) return error;
        const body = data;

        // Check name uniqueness
        const existing = await prisma.pipeline.findUnique({ where: { name: body.name } });
        if (existing) {
            return NextResponse.json({ error: `A pipeline with name "${body.name}" already exists` }, { status: 409 });
        }

        const { id: newId, n: nextOrder } = await generateNextOpaqueId(prisma.pipeline, "P");

        const pipeline = await prisma.pipeline.create({
            data: {
                id: newId,
                name: body.name,
                label: body.label,
                description: body.description ?? null,
                color: body.color ?? "bg-gray-100 text-gray-600",
                isDefault: false,
                isActive: body.isActive ?? true,
                order: body.order ?? nextOrder,
            },
        });
        revalidateTag(NAV_MASTERS_TAG, { expire: 0 });
        return NextResponse.json(pipeline, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create pipeline");
    }
}
