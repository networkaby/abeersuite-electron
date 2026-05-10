import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

// GET /api/inventory/reports/stock-summary
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const products = await prisma.invProduct.findMany({
        where:   { isActive: true },
        orderBy: { name: "asc" },
        select: {
            id:               true,
            sku:              true,
            name:             true,
            stock:            true,
            lowStockThreshold: true,
            costPaise:        true,
            unit:    { select: { code: true, label: true } },
            brand:   { select: { name: true } },
            category:{ select: { name: true } },
        },
    });

    const rows = products.map((p) => ({
        ...p,
        isLow: p.stock != null && p.stock <= p.lowStockThreshold,
    }));

    return NextResponse.json(rows);
}
