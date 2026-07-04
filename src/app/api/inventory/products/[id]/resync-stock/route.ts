import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// POST /api/inventory/products/[id]/resync-stock
//
// Maintenance utility — recomputes `InvProduct.stock` and every
// `InvProductBranch.stock` row from the `InvStockLedger` rows for this
// product. Use when an older voucher path left the caches drifted away
// from the ledger truth (the ledger is append-only and authoritative).
//
// Returns the before/after values per branch so the caller can verify
// the drift was real.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.PRODUCTS_EDIT, PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;

        const before = await prisma.invProduct.findUnique({
            where: { id },
            select: { id: true, stock: true, branchStocks: { select: { branchId: true, stock: true } } },
        });
        if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const ledger = await prisma.invStockLedger.findMany({
            where:  { productId: id },
            select: { branchId: true, inQty: true, outQty: true },
        });
        const byBranch = new Map<string, number>();
        for (const r of ledger) {
            const delta = toNumber(r.inQty) - toNumber(r.outQty);
            byBranch.set(r.branchId, (byBranch.get(r.branchId) ?? 0) + delta);
        }
        const orgTotal = Array.from(byBranch.values()).reduce((s, v) => s + v, 0);

        const result = await prisma.$transaction(async (tx) => {
            // Upsert / patch every branch row to match the ledger sum.
            for (const [branchId, stock] of byBranch.entries()) {
                await tx.invProductBranch.upsert({
                    where:  { productId_branchId: { productId: id, branchId } },
                    create: { productId: id, branchId, stock: Math.round(stock) },
                    update: { stock: Math.round(stock) },
                });
            }
            // Wipe any per-branch row not present in the ledger (e.g., a
            // branch row that had a +N from a path now gone with no ledger
            // trace whatsoever).
            const ledgerBranchIds = Array.from(byBranch.keys());
            if (ledgerBranchIds.length > 0) {
                await tx.invProductBranch.deleteMany({
                    where: { productId: id, branchId: { notIn: ledgerBranchIds } },
                });
            } else {
                await tx.invProductBranch.deleteMany({ where: { productId: id } });
            }
            // Patch the org-wide cache to match the sum.
            const updated = await tx.invProduct.update({
                where: { id },
                data:  { stock: Math.round(orgTotal) },
                select: { id: true, stock: true, branchStocks: { select: { branchId: true, stock: true } } },
            });
            return updated;
        });

        return NextResponse.json({
            before: { stock: before.stock, branchStocks: before.branchStocks },
            after:  { stock: result.stock,  branchStocks: result.branchStocks  },
            ledgerSumByBranch: Object.fromEntries(byBranch.entries()),
        });
    } catch (e) {
        return handleApiError(e, "Failed to resync stock");
    }
}
