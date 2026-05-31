import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";

/**
 * GET /api/inventory/products/prices
 *
 * Lightweight price-only snapshot for POS counters to re-sync the materialized
 * effective sale price WITHOUT re-running the work the full `products/lookup`
 * does (GST/HSN cascade + last-inward cost-ledger walk per product). A price
 * freeze only changes the price (and at most MRP) — never tax, cost, name or
 * warranty — so a refresh only needs the price columns.
 *
 * This is a single indexed SELECT returning a few small ints per row, so it
 * stays cheap even when many counters call it. POS calls it once when a sale
 * starts (a counter idle for hours picks up prices re-frozen meanwhile) and
 * merges the result into its in-memory product list by id. Cart lines are
 * already snapshotted, so a sale in progress is never affected.
 */
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const rows = await prisma.invProduct.findMany({
        where:   { isActive: true },
        select:  { id: true, effectiveSalePricePaise: true, mrpPaise: true },
    });

    return NextResponse.json(rows);
}
