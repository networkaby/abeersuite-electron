import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";

// POST /api/inventory/products/[id]/resync-stock
//
// Maintenance utility — rebuilds `InvProduct.stock` and every
// `InvProductBranch.stock` row for this product from truth. Use when an older
// voucher path left the caches drifted (the ledger is append-only and
// authoritative).
//
// The rebuild is `recomputeProductStock` (stockMovement.ts) — the SAME routine
// the in-place voucher edit and the cancel/restore paths call. This route used
// to carry its own copy of the arithmetic, and the copy was wrong: it set
// `InvProduct.stock` to the bare ledger sum, leaving out `openingStock`. Running
// it on a product whose stock came from an opening balance silently knocked the
// opening quantity off the company figure, and nothing but re-entering the
// opening would bring it back — on live that was 644 of 1467 products. One
// routine, one formula, no second copy to drift.
//
// Returns before/after so the caller can see whether the drift was real.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;

        const snapshot = {
            id: true,
            stock: true,
            openingStock: true,
            branchStocks: { select: { branchId: true, stock: true } },
        } as const;

        const before = await prisma.invProduct.findUnique({ where: { id }, select: snapshot });
        if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const after = await prisma.$transaction(async (tx) => {
            await recomputeProductStock(tx, [id]);
            return tx.invProduct.findUniqueOrThrow({ where: { id }, select: snapshot });
        });

        return NextResponse.json({
            before: { stock: before.stock, branchStocks: before.branchStocks },
            after: { stock: after.stock, branchStocks: after.branchStocks },
            // The opening quantity is org-level and is NOT a ledger row, so it is
            // folded into `stock` but never into a branch row. Reported here so a
            // branch row that looks short can be read against it.
            openingStock: after.openingStock,
        });
    } catch (e) {
        return handleApiError(e, "Failed to resync stock");
    }
}
