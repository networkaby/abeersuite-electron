import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { generateNextOpaqueId, validateRequest, handleApiError } from "@/shared/lib/api";
import { z } from "zod";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const schema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    color: z.string().trim().optional(),
    order: z.coerce.number().int().nonnegative().optional(),
});

// GET /api/work-groups — list groups + the works in each.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const groups = await prisma.workGroup.findMany({
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: { works: { select: { id: true, label: true, color: true }, orderBy: { order: "asc" } } },
        });
        return NextResponse.json(groups);
    } catch (e) {
        return handleApiError(e, "Failed to fetch work groups");
    }
}

// POST /api/work-groups
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, schema);
        if (error) return error;
        const { id, n } = await generateNextOpaqueId(prisma.workGroup, "G");
        const created = await prisma.workGroup.create({
            data: { id, label: data.label, color: data.color ?? "bg-gray-100 text-gray-600", order: data.order ?? n },
        });
        return NextResponse.json(created, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create work group");
    }
}
