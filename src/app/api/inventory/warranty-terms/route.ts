import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invWarrantyTermCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invWarrantyTerm.findMany({ orderBy: { name: "asc" } });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch warranty terms");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invWarrantyTermCreateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invWarrantyTerm.create({
            data: {
                name: b.name,
                description: b.description ?? null,
                durationMonths: b.durationMonths ?? null,
                isActive: b.isActive ?? true,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create warranty term");
    }
}
