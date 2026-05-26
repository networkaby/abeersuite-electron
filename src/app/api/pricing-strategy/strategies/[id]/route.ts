import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingStrategyUpdateSchema } from "@/shared/lib/schemas/pricingSchemas";

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
    const id = Number((await params).id);
    return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = await parseId(params);
        if (id == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const row = await prisma.pricingStrategy.findUnique({ where: { id } });
        if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to fetch pricing strategy");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = await parseId(params);
        if (id == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, pricingStrategyUpdateSchema);
        if (error) return error;

        const existing = await prisma.pricingStrategy.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const row = await prisma.pricingStrategy.update({
            where: { id },
            data: {
                ...(data.name            !== undefined ? { name:            data.name } : {}),
                ...(data.brandIds        !== undefined ? { brandIds:        data.brandIds } : {}),
                ...(data.groupIds        !== undefined ? { groupIds:        data.groupIds } : {}),
                ...(data.categoryIds     !== undefined ? { categoryIds:     data.categoryIds } : {}),
                ...(data.attrFilters     !== undefined ? { attrFilters:     data.attrFilters ?? undefined } : {}),
                ...(data.minCostPaise    !== undefined ? { minCostPaise:    data.minCostPaise } : {}),
                ...(data.maxCostPaise    !== undefined ? { maxCostPaise:    data.maxCostPaise } : {}),
                ...(data.minStock        !== undefined ? { minStock:        data.minStock } : {}),
                ...(data.maxStock        !== undefined ? { maxStock:        data.maxStock } : {}),
                ...(data.staleAfterDays  !== undefined ? { staleAfterDays:  data.staleAfterDays } : {}),
                ...(data.markupPercent   !== undefined ? { markupPercent:   data.markupPercent.toString() } : {}),
                ...(data.markupFlatPaise !== undefined ? { markupFlatPaise: data.markupFlatPaise } : {}),
                ...(data.roundingPaise   !== undefined ? { roundingPaise:   data.roundingPaise } : {}),
                ...(data.priority        !== undefined ? { priority:        data.priority } : {}),
                ...(data.costMethod      !== undefined ? { costMethod:      data.costMethod } : {}),
                ...(data.isActive        !== undefined ? { isActive:        data.isActive } : {}),
            },
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update pricing strategy");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = await parseId(params);
        if (id == null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        await prisma.pricingStrategy.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete pricing strategy");
    }
}
