import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { loadMarginLines, marginPct, r2 } from "@/modules/bi/lib/marginEngine";
import { loadPurchaseLines } from "@/modules/bi/lib/purchaseLines";
import { withApiError } from "@/shared/lib/api";

// Heavy aggregation: every sale + purchase line in the period.
export const maxDuration = 60;

// GET /api/bi/item-by-party?from&to&branchId[&productId]
//
// Without productId: one row per item traded in the period — sold qty/revenue/
// profit (margin engine) and bought qty/value (purchase lines) side by side.
// With productId: the party breakup for that one item — which customers bought
// it (qty, revenue, profit) and which suppliers supplied it (qty, value, rate).
export const GET = withApiError("Failed to build the item-by-party report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const productParam = searchParams.get("productId");

    const [{ lines, costMethod }, purchases, branches] = await Promise.all([
        loadMarginLines({ from, to, branchId }),
        loadPurchaseLines({ from, to, branchId }),
        prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    if (productParam !== null) {
        // Drill-down: party breakup for one item.
        const productId = Number(productParam);

        const byCustomer = new Map<number, { accountId: number; qty: number; revenue: number; profit: number }>();
        for (const l of lines) {
            if (l.productId !== productId) continue;
            const key = l.accountId ?? 0;
            const row = byCustomer.get(key) ?? { accountId: key, qty: 0, revenue: 0, profit: 0 };
            row.qty += l.qtyOut;
            row.revenue += l.revenue;
            row.profit += l.profit;
            byCustomer.set(key, row);
        }

        const bySupplier = new Map<number, { accountId: number; qty: number; value: number }>();
        for (const p of purchases) {
            if (p.productId !== productId) continue;
            const key = p.accountId ?? 0;
            const row = bySupplier.get(key) ?? { accountId: key, qty: 0, value: 0 };
            row.qty += p.qty;
            row.value += p.value;
            bySupplier.set(key, row);
        }

        const accountIds = [...new Set([...byCustomer.keys(), ...bySupplier.keys()])].filter((id) => id !== 0);
        const accounts = accountIds.length > 0
            ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
            : [];
        const nameById = new Map(accounts.map((a) => [a.id, a.name]));

        return NextResponse.json({
            period: { from, to },
            customers: [...byCustomer.values()]
                .map((r) => ({
                    accountId: r.accountId,
                    name: r.accountId === 0 ? "Walk-in / Cash" : (nameById.get(r.accountId) ?? `Account #${r.accountId}`),
                    qty: r2(r.qty), revenue: r2(r.revenue), profit: r2(r.profit), marginPct: marginPct(r.revenue, r.profit),
                }))
                .sort((a, b) => b.revenue - a.revenue),
            suppliers: [...bySupplier.values()]
                .map((r) => ({
                    accountId: r.accountId,
                    name: r.accountId === 0 ? "(no supplier)" : (nameById.get(r.accountId) ?? `Account #${r.accountId}`),
                    qty: r2(r.qty), value: r2(r.value), avgRate: r.qty !== 0 ? r2(r.value / r.qty) : 0,
                }))
                .sort((a, b) => b.value - a.value),
        });
    }

    const byItem = new Map<number, {
        productId: number; sku: string; name: string;
        soldQty: number; revenue: number; profit: number;
        customers: Set<number>; boughtQty: number; buyValue: number; suppliers: Set<number>;
    }>();
    const rowFor = (productId: number, sku: string, name: string) =>
        byItem.get(productId) ?? {
            productId, sku, name,
            soldQty: 0, revenue: 0, profit: 0, customers: new Set<number>(),
            boughtQty: 0, buyValue: 0, suppliers: new Set<number>(),
        };
    for (const l of lines) {
        const row = rowFor(l.productId, l.sku, l.productName);
        row.soldQty += l.qtyOut;
        row.revenue += l.revenue;
        row.profit += l.profit;
        row.customers.add(l.accountId ?? 0);
        byItem.set(l.productId, row);
    }
    for (const p of purchases) {
        const row = rowFor(p.productId, p.sku, p.productName);
        row.boughtQty += p.qty;
        row.buyValue += p.value;
        row.suppliers.add(p.accountId ?? 0);
        byItem.set(p.productId, row);
    }

    const rows = [...byItem.values()]
        .map((r) => ({
            productId: r.productId, sku: r.sku, name: r.name,
            soldQty: r2(r.soldQty), revenue: r2(r.revenue), profit: r2(r.profit),
            marginPct: marginPct(r.revenue, r.profit), customers: r.customers.size,
            boughtQty: r2(r.boughtQty), buyValue: r2(r.buyValue), suppliers: r.suppliers.size,
        }))
        .sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({ period: { from, to }, costMethod, branches, rows });
});
