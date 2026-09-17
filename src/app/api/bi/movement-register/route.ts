import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { openingAppliesTo } from "@/modules/inventory/lib/liveStock";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { r2 } from "@/modules/bi/lib/marginEngine";

export const maxDuration = 60;

// GET /api/bi/movement-register?from&to&branchId[&productId]
//
// Without productId: one row per product — opening qty, in/out qty and value
// for the period, closing qty. Opening = master openingStock (all-branches
// view only; the master opening has no branch) + Σ(in − out) before `from`.
// With productId: the dated in/out ledger rows for that product in the period,
// plus the product's opening so the UI can run a balance column.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const productParam = searchParams.get("productId");

    const ledgerWhere = {
        ...(branchId ? { branchId } : {}),
        universalVoucher: { status: "POSTED" as const, deletedAt: null },
    };

    if (productParam !== null) {
        const productId = Number(productParam);
        const [entries, priorSums, product] = await Promise.all([
            prisma.invStockLedger.findMany({
                where: { ...ledgerWhere, productId, date: { gte: from, lte: to } },
                select: {
                    id: true, date: true, inQty: true, outQty: true, rate: true, amount: true,
                    branch: { select: { name: true } },
                    universalVoucher: { select: { id: true, type: true, voucherNo: true } },
                },
                orderBy: [{ date: "asc" }, { id: "asc" }],
            }),
            prisma.invStockLedger.aggregate({
                where: { ...ledgerWhere, productId, date: { lt: from } },
                _sum: { inQty: true, outQty: true },
            }),
            prisma.invProduct.findMany({
                where: { id: productId },
                select: { id: true, sku: true, name: true, openingStock: true, openingStockDate: true, openingBranchId: true },
            }).then((r) => r[0] ?? null),
        ]);

        // The branch half of this test is liveStock.ts's rule, shared rather than
        // restated: fold the opening when the scope is org-wide, when the opening
        // is unassigned, or when it is lying at the branch being asked about. It
        // used to be `!branchId`, which hid the opening from EVERY branch view —
        // so a product that opened with stock and had not moved since read as
        // nothing on this report, even at its own branch.
        const masterOpening = product?.openingStock != null
            && openingAppliesTo(product, branchId)
            && (!product.openingStockDate || product.openingStockDate < from)
            ? toNumber(product.openingStock) : 0;
        const opening = masterOpening
            + toNumber(priorSums._sum.inQty ?? 0)
            - toNumber(priorSums._sum.outQty ?? 0);

        return NextResponse.json({
            period: { from, to },
            product,
            opening: r2(opening),
            entries: entries.map((e) => ({
                id: e.id,
                date: e.date,
                branch: e.branch.name,
                voucherId: e.universalVoucher.id,
                voucherType: e.universalVoucher.type,
                voucherNo: e.universalVoucher.voucherNo,
                inQty: r2(toNumber(e.inQty)),
                outQty: r2(toNumber(e.outQty)),
                rate: r2(toNumber(e.rate)),
                amount: r2(toNumber(e.amount)),
            })),
        });
    }

    const [inSums, outSums, priorSums, products, branches] = await Promise.all([
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, inQty: { gt: 0 }, date: { gte: from, lte: to } },
            _sum: { inQty: true, amount: true },
        }),
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, outQty: { gt: 0 }, date: { gte: from, lte: to } },
            _sum: { outQty: true, amount: true },
        }),
        prisma.invStockLedger.groupBy({
            by: ["productId"],
            where: { ...ledgerWhere, date: { lt: from } },
            _sum: { inQty: true, outQty: true },
        }),
        prisma.invProduct.findMany({
            where: { isActive: true },
            select: {
                id: true, sku: true, name: true,
                openingStock: true, openingStockDate: true, openingBranchId: true,
                unit: { select: { code: true } },
                category: { select: { name: true } },
            },
            orderBy: { name: "asc" },
        }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const inByProduct = new Map(inSums.map((s) => [s.productId, s]));
    const outByProduct = new Map(outSums.map((s) => [s.productId, s]));
    const priorByProduct = new Map(priorSums.map((s) => [s.productId, s]));

    const rows = [];
    for (const p of products) {
        // Same shared rule as the single-product branch above.
        const masterOpening = p.openingStock != null
            && openingAppliesTo(p, branchId)
            && (!p.openingStockDate || p.openingStockDate < from)
            ? toNumber(p.openingStock) : 0;
        const prior = priorByProduct.get(p.id);
        const opening = masterOpening
            + (prior ? toNumber(prior._sum.inQty ?? 0) - toNumber(prior._sum.outQty ?? 0) : 0);
        const inRow = inByProduct.get(p.id);
        const outRow = outByProduct.get(p.id);
        const inQty = inRow ? toNumber(inRow._sum.inQty ?? 0) : 0;
        const inValue = inRow ? toNumber(inRow._sum.amount ?? 0) : 0;
        const outQty = outRow ? toNumber(outRow._sum.outQty ?? 0) : 0;
        const outValue = outRow ? toNumber(outRow._sum.amount ?? 0) : 0;
        if (opening === 0 && inQty === 0 && outQty === 0) continue;
        rows.push({
            productId: p.id,
            sku: p.sku,
            name: p.name,
            unit: p.unit?.code ?? null,
            category: p.category?.name ?? null,
            opening: r2(opening),
            inQty: r2(inQty),
            inValue: r2(inValue),
            outQty: r2(outQty),
            outValue: r2(outValue),
            closing: r2(opening + inQty - outQty),
        });
    }

    const totals = rows.reduce(
        (t, r) => ({ inQty: t.inQty + r.inQty, inValue: t.inValue + r.inValue, outQty: t.outQty + r.outQty, outValue: t.outValue + r.outValue }),
        { inQty: 0, inValue: 0, outQty: 0, outValue: 0 },
    );

    return NextResponse.json({
        period: { from, to },
        branches,
        rows,
        totals: { inQty: r2(totals.inQty), inValue: r2(totals.inValue), outQty: r2(totals.outQty), outValue: r2(totals.outValue) },
    });
}
