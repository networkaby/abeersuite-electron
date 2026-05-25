import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";

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
                warrantyTerm: { select: { name: true, durationDays: true } },
            },
        });
        if (!product) return NextResponse.json(null);
        const { products: taxByProduct } = await resolveProductTaxBatch({ productIds: [product.id] });
        const resolved = taxByProduct.get(product.id);
        return NextResponse.json({
            ...product,
            taxRate: resolved?.gstRate ?? null,
            hsnCode: resolved?.hsnCode ?? null,
        });
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
            warrantyTerm: { select: { name: true, durationDays: true } },
        },
    });

    // Resolve effective GST + HSN per product via the cascade (product →
    // group chain → org defaults). Batch-resolved in 3 queries so this stays
    // cheap even with thousands of products. Snapshot consumers (POS cart,
    // voucher line entry) read taxRate/hsnCode to seed their per-line values.
    const { products: taxByProduct } = await resolveProductTaxBatch({
        productIds: products.map((p) => p.id),
    });

    const enriched = products.map((p) => {
        const r = taxByProduct.get(p.id);
        return {
            ...p,
            taxRate: r?.gstRate ?? null,
            hsnCode: r?.hsnCode ?? null,
        };
    });

    return NextResponse.json(enriched);
}
