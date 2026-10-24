import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { productOpeningValue } from "@/modules/inventory/lib/stockValue";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { openingBranchOnSave } from "@/modules/inventory/lib/liveStock";
import { requireWritableBranchId } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";

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
        // Editing the opening moves the saved total by the change in the opening,
        // not to the opening itself — rebuilt from the ledger, same transaction.
        const session = await auth();
        const product = await prisma.$transaction(async (tx) => {
            const current = await tx.invProduct.findUniqueOrThrow({
                where: { id: Number(id) }, select: { openingBranchId: true },
            });
            await tx.invProduct.update({
                where: { id: Number(id) },
                data: {
                    openingStock:     data.qty,
                    openingRate:      data.rate,
                    openingValue:     productOpeningValue(opening),
                    openingStockDate: null,
                    // Where the quantity is lying — see openingBranchOnSave.
                    openingBranchId: openingBranchOnSave(
                        data.qty, current.openingBranchId, () => requireWritableBranchId(req, session),
                    ),
                },
            });
            await recomputeProductStock(tx, [Number(id)]);
            return tx.invProduct.findUniqueOrThrow({ where: { id: Number(id) } });
        });
        return NextResponse.json(product);
    } catch (e) {
        return handleApiError(e, "Failed to update opening stock");
    }
}
