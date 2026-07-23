import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// POST /api/inventory/products/bulk-reorder
//
// Bulk-set the reorder inputs on many products at once (the Reorder page's
// "apply to N shown" action — e.g. filter Group=Hard Disk, set lead time 10d
// for all of them in one go). Only the provided fields are written; an
// explicit leadTimeDays: null clears per-item overrides back to the org
// default. Same gate as the single-product PATCH (products:edit).
const bodySchema = z.object({
    productIds: z.array(z.number().int().positive()).min(1).max(10_000),
    /// Days; null = clear override (ride OrgDefaults.defaultLeadTimeDays).
    leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
    /// Manual minimum-alert floor.
    lowStockThreshold: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;
        if (data.leadTimeDays === undefined && data.lowStockThreshold === undefined) {
            return NextResponse.json({ error: "Nothing to apply — set lead time and/or min floor." }, { status: 400 });
        }
        const { count } = await prisma.invProduct.updateMany({
            where: { id: { in: data.productIds } },
            data: {
                ...(data.leadTimeDays !== undefined ? { leadTimeDays: data.leadTimeDays } : {}),
                ...(data.lowStockThreshold !== undefined ? { lowStockThreshold: data.lowStockThreshold } : {}),
            },
        });
        return NextResponse.json({ updated: count });
    } catch (e) {
        return handleApiError(e, "Failed to bulk-apply reorder settings");
    }
}
