import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingStrategyCreateSchema } from "@/shared/lib/schemas/pricingSchemas";

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const rows = await prisma.pricingStrategy.findMany({
            orderBy: [{ scope: "asc" }, { priority: "desc" }, { id: "asc" }],
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch pricing strategies");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, pricingStrategyCreateSchema);
        if (error) return error;
        const row = await prisma.pricingStrategy.create({
            data: {
                name:            data.name,
                scope:           data.scope,
                scopeId:         data.scopeId,
                markupPercent:   data.markupPercent.toString(),
                markupFlatPaise: data.markupFlatPaise,
                roundingPaise:   data.roundingPaise,
                priority:        data.priority,
                isActive:        data.isActive ?? true,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create pricing strategy");
    }
}
