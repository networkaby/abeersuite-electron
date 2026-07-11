import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { invUnitCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { revalidateTag } from "next/cache";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Tag exported so the [id] route's PATCH/DELETE can revalidate.
export const INV_UNITS_TAG = "inv-units";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Units is a small master list (~13 rows) that changes only when an admin
        // adds/edits a unit. Direct DB hit keeps it always fresh — no stale-cache
        // surprises after seeding or imports.
        const rows = await prisma.invUnit.findMany({ orderBy: { code: "asc" } });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch units");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invUnitCreateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invUnit.create({
            data: {
                code: b.code.toUpperCase(),
                label: b.label,
                decimals: b.decimals ?? 0,
                isActive: b.isActive ?? true,
            },
        });
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Unit code already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create unit");
    }
}
