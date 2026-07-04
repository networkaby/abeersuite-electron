import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { costPoolDrawUpdateSchema } from "@/shared/lib/schemas/costPoolSchemas";

// PATCH /api/pricing-strategy/costing/draws/[id] — edit an existing draw
// (amount / per-unit / quantity / note). Kind, source entry and product are
// fixed. `amountPaise` is re-capped against the source entry (line total minus
// every OTHER draw on it). No GL impact — only `cost_pool_draws` is written.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.PRICING_COSTING_MANAGE, PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id } = await ctx.params;
        const drawId = Number(id);
        if (!Number.isInteger(drawId) || drawId <= 0) {
            return NextResponse.json({ error: "Invalid draw id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, costPoolDrawUpdateSchema);
        if (error) return error;

        const draw = await prisma.additionalCostAllocation.findUnique({
            where: { id: drawId },
            select: { id: true, kind: true, sourceVoucherGlLineId: true, amountPaise: true },
        });
        if (!draw) return NextResponse.json({ error: "Draw not found" }, { status: 404 });

        // Re-cap the amount: line total − every other draw on the same entry.
        if (data.amountPaise != null && data.amountPaise !== draw.amountPaise) {
            const [line, others] = await Promise.all([
                prisma.voucherGlLine.findUnique({ where: { id: draw.sourceVoucherGlLineId ?? -1 }, select: { amount: true } }),
                prisma.additionalCostAllocation.aggregate({
                    _sum: { amountPaise: true },
                    where: { sourceVoucherGlLineId: draw.sourceVoucherGlLineId, id: { not: draw.id } },
                }),
            ]);
            if (!line) return NextResponse.json({ error: "Source entry no longer exists." }, { status: 400 });
            const cap = Math.round(toNumber(line.amount) * 100) - (others._sum.amountPaise ?? 0);
            if (data.amountPaise > cap) {
                return NextResponse.json(
                    { error: `Amount exceeds the entry's available ₹${(cap / 100).toFixed(2)}.` },
                    { status: 400 },
                );
            }
        }

        // perUnit / quantity only apply to ALLOCATION draws.
        const isAlloc = draw.kind === "ALLOCATION";
        await prisma.additionalCostAllocation.update({
            where: { id: drawId },
            data: {
                ...(data.amountPaise != null ? { amountPaise: data.amountPaise } : {}),
                ...(data.note !== undefined ? { note: data.note } : {}),
                ...(isAlloc && data.perUnitPaise !== undefined ? { perUnitPaise: data.perUnitPaise } : {}),
                ...(isAlloc && data.quantity !== undefined ? { quantity: data.quantity } : {}),
            },
        });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to update draw");
    }
}

// DELETE /api/pricing-strategy/costing/draws/[id] — undo a draw (history
// correction). Restores that entry's remaining; no GL impact.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.PRICING_COSTING_MANAGE, PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id } = await ctx.params;
        const drawId = Number(id);
        if (!Number.isInteger(drawId) || drawId <= 0) {
            return NextResponse.json({ error: "Invalid draw id" }, { status: 400 });
        }
        await prisma.additionalCostAllocation.delete({ where: { id: drawId } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete draw");
    }
}
