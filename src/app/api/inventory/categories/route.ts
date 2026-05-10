import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invCategoryCreateSchema } from "@/shared/lib/schemas/inventorySchemas";

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invCategory.findMany({
            orderBy: { name: "asc" },
            include: { parent: { select: { id: true, name: true } } },
        });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const parsed = invCategoryCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
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
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
    }
}
