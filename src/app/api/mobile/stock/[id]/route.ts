import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { loadLiveStockByBranch } from "@/modules/inventory/lib/liveStock";

// GET /api/mobile/stock/[id] — one product's available quantity, split per branch.
// Same rule as the Item Ledger's branch picker (loadLiveStockByBranch).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.MOBILE_STOCK_VIEW);
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const product = await prisma.invProduct.findUnique({
            where: { id },
            select: { id: true, openingStock: true, openingBranchId: true },
        });
        if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        const [{ total, byBranch }, branches] = await Promise.all([
            loadLiveStockByBranch(product),
            prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        ]);
        const names = new Map(branches.map((b) => [b.id, b.name]));

        return NextResponse.json({
            total,
            branches: [...byBranch.entries()]
                .map(([branchId, qty]) => ({ branchId, name: names.get(branchId) ?? branchId, qty }))
                .sort((a, b) => b.qty - a.qty),
        });
    } catch (e) {
        return handleApiError(e, "Could not load branch stock");
    }
}
