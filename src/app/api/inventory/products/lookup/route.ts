import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

/**
 * GET /api/inventory/products/lookup
 * Lightweight product list for voucher item pickers.
 * Requires only authentication (not inventory:manage) so finance
 * users can search products when creating purchase/sale vouchers.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const products = await prisma.invProduct.findMany({
        where:   { isActive: true },
        orderBy: { name: "asc" },
        select: {
            id:                true,
            sku:               true,
            name:              true,
            stock:             true,
            lowStockThreshold: true,
            pricePaise:        true,
            costPaise:         true,
            mrpPaise:          true,
            barcode1:          true,
            unit:         { select: { code: true } },
            brand:        { select: { name: true } },
            warrantyTerm: { select: { name: true, durationMonths: true } },
        },
    });

    return NextResponse.json(products);
}
