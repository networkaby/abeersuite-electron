import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { productOpeningValue, syncProductCacheFromOpening } from "@/modules/inventory/lib/stockValue";

// PUT /api/inventory/products/[id]/opening
// Sets opening stock qty, rate, and value on a product master. Universal
// opening — no per-product date; always effective from the start of the
// books, whether imported or created fresh.
const schema = z.object({
    qty:      z.number().nullable(),
    rate:     z.number().nullable(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    // Map { qty, rate } → shared { openingStock, openingRate } shape so the
    // helpers in stockValue.ts can be reused.
    const opening = { openingStock: data.qty, openingRate: data.rate };

    try {
        const product = await prisma.invProduct.update({
            where: { id: Number(id) },
            data: {
                openingStock:     data.qty,
                openingRate:      data.rate,
                openingValue:     productOpeningValue(opening),
                openingStockDate: null,
                // Clearing the quantity clears where it was lying. This route
                // does not otherwise touch openingBranchId, so a location set
                // by the importer survives an edit to the rate — but a location
                // left behind on a product that now opens with nothing would be
                // a stock location for no stock.
                ...(data.qty == null ? { openingBranchId: null } : {}),
                // PR 3 simplified this to just `stock` — the opening rate
                // seeds cost via the synthetic first lot in loadInwardLots,
                // so no cache column needs touching.
                ...syncProductCacheFromOpening(opening),
            },
        });
        return NextResponse.json(product);
    } catch (e) {
        return handleApiError(e, "Failed to update opening stock");
    }
}
