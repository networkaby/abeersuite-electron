import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission, requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const createSchema = z.object({
    key:        z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase letters, digits, underscores, starting with a letter"),
    name:       z.string().min(1).max(100),
    categoryId: z.number().int().positive().nullish(),
    sortOrder:  z.number().int().min(0).default(0),
    isActive:   z.boolean().default(true),
});

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const url = new URL(req.url);
        const categoryIdParam = url.searchParams.get("categoryId");
        const categoryId = categoryIdParam ? Number(categoryIdParam) : undefined;

        const rows = await prisma.invAttributeMaster.findMany({
            where: categoryId != null
                ? { OR: [{ categoryId }, { categoryId: null }] }
                : undefined,
            orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
            include: { category: { select: { id: true, name: true } } },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch attribute masters");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.INVENTORY_MASTERS_CREATE, PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const row = await prisma.invAttributeMaster.create({
            data: {
                key:        data.key,
                name:       data.name,
                categoryId: data.categoryId ?? null,
                sortOrder:  data.sortOrder,
                isActive:   data.isActive,
            },
            include: { category: { select: { id: true, name: true } } },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: "Key already exists for this category" }, { status: 409 });
        }
        return handleApiError(e, "Failed to create attribute master");
    }
}
