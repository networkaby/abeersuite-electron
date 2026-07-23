import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { invCategoryCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.invCategory.findMany({
            orderBy: { name: "asc" },
            include: { parent: { select: { id: true, name: true } } },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch categories");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invCategoryCreateSchema);
        if (error) return error;
        const b = data;
        if (b.parentId) {
            const p = await prisma.invCategory.findUnique({ where: { id: b.parentId } });
            if (!p) return NextResponse.json({ error: "Parent category not found" }, { status: 400 });
        }
        if (b.slug) {
            const clash = await prisma.invCategory.findUnique({ where: { slug: b.slug } });
            if (clash) return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
        }
        const row = await prisma.invCategory.create({
            data: {
                name: b.name,
                slug: b.slug ?? null,
                parentId: b.parentId ?? null,
                isActive: b.isActive ?? true,
                slowAfterDays:      b.slowAfterDays      ?? null,
                nonMovingAfterDays: b.nonMovingAfterDays ?? null,
                deadAfterDays:      b.deadAfterDays      ?? null,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create category");
    }
}
