import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { handleApiError } from "@/shared/lib/api";

// GET /api/inventory/stock-ledger/[productId]?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ productId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { productId } = await params;
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam   = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : new Date(new Date().getFullYear(), 0, 1);
    const to   = toParam   ? new Date(toParam)   : new Date();
    to.setHours(23, 59, 59, 999);

    const product = await prisma.invProduct.findUnique({
        where: { id: Number(productId) },
        include: { unit: { select: { code: true, label: true } } },
    });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    try {
        // Opening qty: all POSTED entries before the 'from' date
        const openingEntries = await prisma.invStockLedger.findMany({
            where: {
                productId: Number(productId),
                voucher:   { status: "POSTED" },
                date:      { lt: from },
            },
            select: { inQty: true, outQty: true },
        });
        const openingQty = openingEntries.reduce(
            (acc, e) => acc + toNumber(e.inQty) - toNumber(e.outQty),
            0,
        );

        // Entries within the date range
        const entries = await prisma.invStockLedger.findMany({
            where: {
                productId: Number(productId),
                voucher:   { status: "POSTED" },
                date:      { gte: from, lte: to },
            },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            include: {
                voucher: {
                    select: { id: true, reference: true, type: true, description: true, partyName: true },
                },
            },
        });

        // Compute running balance (same pattern as account ledger)
        let runningQty = openingQty;
        const rows = entries.map((e) => {
            const inQ  = toNumber(e.inQty);
            const outQ = toNumber(e.outQty);
            runningQty += inQ - outQ;
            return {
                id:          e.id,
                date:        e.date,
                reference:   e.voucher.reference,
                voucherType: e.voucher.type,
                description: e.voucher.description,
                partyName:   e.voucher.partyName,
                inQty:       inQ  > 0 ? inQ  : null,
                outQty:      outQ > 0 ? outQ : null,
                rate:        toNumber(e.rate),
                amount:      toNumber(e.amount),
                balance:     runningQty,
            };
        });

        return NextResponse.json({
            product: {
                id:   product.id,
                sku:  product.sku,
                name: product.name,
                unit: product.unit,
            },
            from:          from.toISOString(),
            to:            to.toISOString(),
            openingQty,
            closingQty:    runningQty,
            rows,
        });
    } catch (e) {
        return handleApiError(e, "Failed to generate stock ledger");
    }
}
