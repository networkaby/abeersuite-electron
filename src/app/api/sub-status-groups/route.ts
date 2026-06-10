import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createSchema = z.object({
    label: z.string().trim().min(1, "Label is required"),
    order: z.coerce.number().int().nonnegative().optional(),
});

// GET /api/sub-status-groups
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const groups = await prisma.work.findMany({ orderBy: { order: "asc" } });
        return NextResponse.json(groups);
    } catch (e) {
        return handleApiError(e, "Failed to fetch groups");
    }
}

// POST /api/sub-status-groups
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_STATUSES);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { label, order } = data;
        const id = label.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

        const existing = await prisma.work.findUnique({ where: { id } });
        if (existing) {
            return NextResponse.json({ error: `A group with id "${id}" already exists.` }, { status: 409 });
        }

        const maxOrder = order ?? (await prisma.work.count());
        const group = await prisma.work.create({ data: { id, label, order: maxOrder } });
        return NextResponse.json(group, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create group");
    }
}
