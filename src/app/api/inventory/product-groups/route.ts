import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductGroupCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const rows = await prisma.invProductGroup.findMany({ orderBy: { name: "asc" } });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch product groups");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invProductGroupCreateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invProductGroup.create({
            data: { name: b.name, isActive: b.isActive ?? true },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Group name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create product group");
    }
}
