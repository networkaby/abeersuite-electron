import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { repairStockDrift } from "@/modules/inventory/lib/stockDrift";
import { recheckPublished } from "@/modules/ecommerce/lib/applyPublished";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stock-check — nightly, Vercel Cron (vercel.json).
 *
 * The safety net under the stock-total cache: any product whose saved stock no
 * longer matches opening + its stock entries is rewritten from the ledger, then
 * every Published product is re-judged so one that was held Pending by a wrong
 * total goes live without anyone clicking Re-check pending.
 *
 * A repair is logged with the SKUs, so a cause that keeps coming back shows up
 * in the Vercel logs instead of being silently fixed every night.
 */
export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "CRON"))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const fixed = await repairStockDrift();
    if (fixed.length > 0) {
        const skus = await prisma.invProduct.findMany({ where: { id: { in: fixed } }, select: { sku: true } });
        console.warn(
            `[cron/stock-check] repaired ${fixed.length} stock total(s) that did not match their stock entries: ` +
            skus.map((s) => s.sku).join(", "),
        );
    }
    const recheck = await recheckPublished();
    return NextResponse.json({ repaired: fixed.length, recheck });
}
