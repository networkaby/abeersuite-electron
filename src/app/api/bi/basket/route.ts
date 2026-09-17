import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, r2 } from "@/modules/bi/lib/marginEngine";
import { withApiError } from "@/shared/lib/api";

export const maxDuration = 60;

/** A pair must co-occur on at least this many bills to be reported. */
const MIN_PAIR_BILLS = 2;
const MAX_PAIRS = 50;

// GET /api/bi/basket?from&to&branchId
//
// Market-basket pairs: products bought together on the same bill.
//   support    = pair bills ÷ all bills in the period
//   confidence = pair bills ÷ bills containing one side
// Sale returns don't form baskets — only positive-qty sale lines count.
export const GET = withApiError("Failed to build the basket analysis", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;

    const [{ lines }, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    // Distinct products per bill (positive sale lines only).
    const productsByVoucher = new Map<number, Set<number>>();
    const nameByProduct = new Map<number, string>();
    for (const l of lines) {
        if (l.qtyOut <= 0) continue;
        nameByProduct.set(l.productId, l.productName);
        const set = productsByVoucher.get(l.voucherId) ?? new Set<number>();
        set.add(l.productId);
        productsByVoucher.set(l.voucherId, set);
    }

    const totalBills = productsByVoucher.size;
    const billsByProduct = new Map<number, number>();
    const pairBills = new Map<string, number>();
    for (const set of productsByVoucher.values()) {
        const ids = [...set].sort((a, b) => a - b);
        for (const id of ids) billsByProduct.set(id, (billsByProduct.get(id) ?? 0) + 1);
        for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) {
                const key = `${ids[i]}:${ids[j]}`;
                pairBills.set(key, (pairBills.get(key) ?? 0) + 1);
            }
        }
    }

    const rows = [...pairBills.entries()]
        .filter(([, count]) => count >= MIN_PAIR_BILLS)
        .map(([key, count]) => {
            const [a, b] = key.split(":").map(Number);
            return {
                productAId: a,
                productBId: b,
                nameA: nameByProduct.get(a) ?? `#${a}`,
                nameB: nameByProduct.get(b) ?? `#${b}`,
                bills: count,
                supportPct: totalBills > 0 ? r2((count / totalBills) * 100) : 0,
                confidenceAtoB: r2((count / (billsByProduct.get(a) ?? count)) * 100),
                confidenceBtoA: r2((count / (billsByProduct.get(b) ?? count)) * 100),
            };
        })
        .sort((x, y) => y.bills - x.bills || y.supportPct - x.supportPct)
        .slice(0, MAX_PAIRS);

    return NextResponse.json({
        period: { from, to },
        branches,
        totalBills,
        minPairBills: MIN_PAIR_BILLS,
        rows,
    });
});
