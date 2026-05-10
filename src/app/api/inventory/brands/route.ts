import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invBrandCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invBrand.findMany({ orderBy: { name: "asc" } });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch brands" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const parsed = invBrandCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        const row = await prisma.invBrand.create({
            data: { name: b.name, isActive: b.isActive ?? true },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Brand name already exists");
        if (conflict) return conflict;
        return NextResponse.json({ error: "Failed to create brand" }, { status: 500 });
    }
}
