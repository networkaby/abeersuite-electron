import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { invBomCreateSchema } from "@/shared/lib/schemas/bomSchemas";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/inventory/boms?active=1
//   Returns every BOM (or only active when ?active=1) with its output product
//   + line items hydrated. Used by the master page (full list) and by the
//   Manufacturing Journal form's BomPicker (passes ?active=1 to filter).
export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const onlyActive = new URL(req.url).searchParams.get("active") === "1";
        const rows = await prisma.invBom.findMany({
            where: onlyActive ? { isActive: true } : {},
            orderBy: { name: "asc" },
            include: {
                outputProduct: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
                lines: {
                    include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } },
                },
            },
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch BOMs");
    }
}

// POST /api/inventory/boms
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invBomCreateSchema);
        if (error) return error;
        const b = data;
        const row = await prisma.invBom.create({
            data: {
                name:            b.name,
                outputProductId: b.outputProductId,
                outputQty:       b.outputQty,
                description:     b.description ?? null,
                isActive:        b.isActive ?? true,
                lines: { create: b.lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
            },
            include: {
                outputProduct: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } },
                lines: { include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } } },
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create BOM");
    }
}
