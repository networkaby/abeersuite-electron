import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { pricingItemUpdateSchema } from "@/shared/lib/schemas/pricingSchemas";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, pricingItemUpdateSchema);
        if (error) return error;

        // Enforce MRP cap on manual price entries. If MRP is set on the product
        // and the caller is trying to write a higher pricePaise, refuse.
        if (data.pricePaise != null && data.pricePaise > 0) {
            const existing = await prisma.invProduct.findUnique({
                where:  { id },
                select: { mrpPaise: true },
            });
            if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
            if (existing.mrpPaise != null && existing.mrpPaise > 0 && data.pricePaise > existing.mrpPaise) {
                return NextResponse.json(
                    {
                        error: `Manual price (₹${(data.pricePaise / 100).toFixed(2)}) exceeds MRP (₹${(existing.mrpPaise / 100).toFixed(2)}). Sell price cannot be above MRP.`,
                    },
                    { status: 400 },
                );
            }
        }

        // Setting pricePaise explicitly flips priceOverridden=true unless the
        // caller is explicitly clearing the override (priceOverridden=false).
        const overrideFlag =
            data.priceOverridden !== undefined
                ? data.priceOverridden
                : data.pricePaise !== undefined
                  ? true
                  : undefined;

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(data.costMethod      !== undefined ? { costMethod:    data.costMethod } : {}),
                ...(data.marginPercent   !== undefined ? { marginPercent: data.marginPercent != null ? data.marginPercent.toString() : null } : {}),
                ...(overrideFlag         !== undefined ? { priceOverridden: overrideFlag } : {}),
                ...(data.pricePaise      !== undefined ? { pricePaise:    data.pricePaise } : {}),
                ...(data.stdCostPaise    !== undefined ? { stdCostPaise:  data.stdCostPaise } : {}),
            },
            select: {
                id:               true,
                costMethod:       true,
                marginPercent:    true,
                priceOverridden:  true,
                pricePaise:       true,
                stdCostPaise:     true,
            },
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update pricing item");
    }
}
