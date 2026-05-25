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

        // Cross-field validation after merging with existing row: a patch that
        // changes scope without also setting scopeId must be checked against
        // the merged result, not the partial payload.
        const existing = await prisma.pricingStrategy.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        const mergedScope   = data.scope   ?? existing.scope;
        const mergedScopeId = data.scopeId !== undefined ? data.scopeId : existing.scopeId;
        if (mergedScope === "ORG" && mergedScopeId != null) {
            return NextResponse.json(
                { error: "ORG scope must not have a scopeId" },
                { status: 400 },
            );
        }
        if (mergedScope !== "ORG" && mergedScopeId == null) {
            return NextResponse.json(
                { error: `${mergedScope} scope requires a scopeId` },
                { status: 400 },
            );
        }

        const row = await prisma.pricingStrategy.update({
            where: { id },
            data: {
                ...(data.name            !== undefined ? { name:            data.name } : {}),
                ...(data.scope           !== undefined ? { scope:           data.scope } : {}),
                ...(data.scopeId         !== undefined ? { scopeId:         data.scopeId } : {}),
                ...(data.markupPercent   !== undefined ? { markupPercent:   data.markupPercent.toString() } : {}),
                ...(data.markupFlatPaise !== undefined ? { markupFlatPaise: data.markupFlatPaise } : {}),
                ...(data.roundingPaise   !== undefined ? { roundingPaise:   data.roundingPaise } : {}),
                ...(data.priority        !== undefined ? { priority:        data.priority } : {}),
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
