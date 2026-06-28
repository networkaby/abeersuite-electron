import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { handleApiError } from "@/shared/lib/api";
import { resolveActiveBranchId } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

// GET /api/inventory/stock-ledger/[productId]?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=BR-HQ|all
export async function GET(req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { productId } = await params;
    const { searchParams } = new URL(req.url);
    const fromParam   = searchParams.get("from");
    const toParam     = searchParams.get("to");
    const branchParam = searchParams.get("branchId");

    let branchFilter: { branchId?: string } = {};
    if (branchParam === "all") {
        // No branch filter
    } else if (branchParam) {
        branchFilter = { branchId: branchParam };
    } else {
        try { branchFilter = { branchId: resolveActiveBranchId(req, session) }; }
        catch { /* fall back to no filter (legacy / admin) */ }
    }

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
                universalVoucher:   { status: "POSTED" },
                date:      { lt: from },
                ...branchFilter,
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
                universalVoucher:   { status: "POSTED" },
                date:      { gte: from, lte: to },
                ...branchFilter,
            },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            include: {
                // Phase 5 5C: the InvVoucher is reached via universalVoucher.invVoucher.
                universalVoucher: {
                    // 5D-5: description on the spine; invVoucher keeps ref/type/partyJson.
                    select: { description: true, invVoucher: { select: { id: true, reference: true, type: true, partyJson: true } } },
                },
            },
        });

        // Compute running balance (same pattern as account ledger)
        let runningQty = openingQty;
        const rows = entries.map((e) => {
            const inQ  = toNumber(e.inQty);
            const outQ = toNumber(e.outQty);
            runningQty += inQ - outQ;
            const v = e.universalVoucher.invVoucher;
            return {
                id:          e.id,
                date:        e.date,
                reference:   v?.reference ?? "—",
                voucherType: v?.type ?? "—",
                description: e.universalVoucher.description ?? null,
                partyName:   readPartyName(v?.partyJson ?? null),
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
