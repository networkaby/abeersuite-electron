import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

/**
 * GET /api/inventory/products/lookup
 *
 * Two modes:
 *
 * 1. **List mode (default)** — returns every active product as a lightweight
 *    list for voucher / dialog pickers. Requires only authentication so any
 *    finance user can search products when entering vouchers.
 *
 * 2. **Single-code mode** — `?code=<sku|barcode|ean|upc>` returns at most one
 *    product whose `sku`, `barcode1-3`, `ean1-3`, or `upc1-3` matches the
 *    given code exactly. Used by the scan-to-add inputs on PhysicalStockPage
 *    and ManufacturingJournalPage. Returns `null` (200) when there's no
 *    match — callers branch on the response without needing an exception.
 */
export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const code = new URL(req.url).searchParams.get("code")?.trim();

    if (code) {
        const product = await prisma.invProduct.findFirst({
            where: {
                isActive: true,
                OR: [
                    { sku:      code },
                    { barcode1: code },
                    { barcode2: code },
                    { barcode3: code },
                    { ean1:     code },
                    { ean2:     code },
                    { ean3:     code },
                    { upc1:     code },
                    { upc2:     code },
                    { upc3:     code },
                ],
            },
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
        return NextResponse.json(product);
    }

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
