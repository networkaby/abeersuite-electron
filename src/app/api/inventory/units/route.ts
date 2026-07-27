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
        const rows = await prisma.invUnit.findMany({
            orderBy: { code: "asc" },
            // Compound units render as "4 DOZ 6 NOS" — the base unit's code is
            // needed alongside the row to print the remainder.
            include: { baseUnit: { select: { id: true, code: true, label: true } } },
        });
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
        // Chains are allowed to any sane depth (KM → M → CM), so the base may
        // itself be a compound unit. Only existence is checked here; cycle and
        // depth checks live in checkCompoundChange (they need an existing id).
        if (b.baseUnitId != null) {
            const base = await prisma.invUnit.findUnique({
                where:  { id: b.baseUnitId },
                select: { id: true },
            });
            if (!base) return NextResponse.json({ error: "Base unit not found" }, { status: 400 });
        }
        const row = await prisma.invUnit.create({
            data: {
                code: b.code.toUpperCase(),
                label: b.label,
                decimals: b.decimals ?? 0,
                isActive: b.isActive ?? true,
                baseUnitId: b.baseUnitId ?? null,
                conversionFactor: b.conversionFactor ?? null,
            },
            include: { baseUnit: { select: { id: true, code: true, label: true } } },
        });
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Unit code already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create unit");
    }
}
