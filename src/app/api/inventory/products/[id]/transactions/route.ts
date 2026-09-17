import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { loadLastInwardCostMap } from "@/modules/inventory/lib/valuation";
import { loadLiveStockByBranch } from "@/modules/inventory/lib/liveStock";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";


// GET /api/inventory/products/[id]/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? (() => { const d = new Date(toParam); d.setHours(23, 59, 59, 999); return d; })() : undefined;

    try {
        const product = await prisma.invProduct.findUnique({
            where: { id },
            select: {
                id: true,
                sku: true,
                name: true,
                stock: true,
                effectiveSalePricePaise: true,
                lowStockThreshold: true,
                openingStock: true,
                openingRate: true,
                openingValue: true,
                openingStockDate: true,
                // Stock location of the opening quantity. loadLiveStockByBranch
                // gives the opening to this branch alone, and adds it to the
                // picker even when the ledger has never mentioned it — the
                // `unnamed` lookup below resolves its name.
                openingBranchId: true,
                unit: { select: { code: true, label: true } },
                category: { select: { name: true } },
                brand: { select: { name: true } },
                branchStocks: {
                    orderBy: { stock: "desc" },
                    select: { stock: true, branch: { select: { id: true, name: true } } },
                },
            },
        });
        if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

        // On-hand comes from the formula, never from the caches. The per-branch
        // cache holds voucher movement only, so reading it raw showed a product
        // whose stock is an opening balance as 0 — see liveStock.ts.
        const live = await loadLiveStockByBranch(
            product,
            product.branchStocks.map((b) => b.branch.id),
        );
        const branchNames = new Map(product.branchStocks.map((b) => [b.branch.id, b.branch.name]));
        const unnamed = [...live.byBranch.keys()].filter((id) => !branchNames.has(id));
        if (unnamed.length > 0) {
            const rows = await prisma.branch.findMany({ where: { id: { in: unnamed } }, select: { id: true, name: true } });
            for (const b of rows) branchNames.set(b.id, b.name);
        }
        const branchStocks = [...live.byBranch.entries()]
            .map(([id, stock]) => ({ stock, branch: { id, name: branchNames.get(id) ?? id } }))
            .sort((a, b) => b.stock - a.stock);

        const lastInward = await loadLastInwardCostMap([{ id: product.id, stock: live.total }]);
        const lastPurchasePaise = lastInward.get(product.id) ?? null;

        // Phase 5 5C: goods lines hang off the spine — the InvVoucher is reached
        // via universalVoucher.voucherDetail.
        const linesRaw = await prisma.voucherInventoryLine.findMany({
            where: {
                productId: id,
                universalVoucher: {
                    status: "POSTED",
                    deletedAt: null,
                    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
                },
            },
            select: {
                id: true,
                quantity: true,
                rate: true,
                amount: true,
                universalVoucher: {
                    select: {
                        voucherNo: true,   // 5D-6: ref on the spine
                        date: true,        // 5D-10: date on the spine
                        type: true,        // 5D-11: type on the spine
                        voucherDetail: {   // 5D-13: the 1:1 sidecar (renamed from invVoucher)
                            select: {
                                id: true,
                                partyJson: true,
                                partyType: true,
                                partyId: true,
                                totalAmount: true,
                            },
                        },
                    },
                },
            },
            orderBy: { universalVoucher: { date: "desc" } },
        });
        const lines = linesRaw
            .filter((l) => l.universalVoucher.voucherDetail != null)
            .map((l) => ({ id: l.id, quantity: l.quantity, rate: l.rate, amount: l.amount, voucher: { ...l.universalVoucher.voucherDetail!, type: l.universalVoucher.type, date: l.universalVoucher.date, reference: l.universalVoucher.voucherNo ?? "" } }));

        type TxRow = {
            lineId:    number;
            voucherId: number;
            type:      string;
            reference: string;
            date:      Date;
            partyName: string | null;
            partyType: string | null;
            partyId:   number | null;
            quantity:  number;
            rate:      number;
            amount:    number;
            unitCode:  string;
            /** "N/A" for synthetic rows (opening); real rows leave it undefined
             *  so the existing receivables/payables resolver can fill it in. */
            paymentStatus?: "PAID" | "PARTIAL" | "UNPAID" | "N/A";
        };
        const transactions: TxRow[] = lines.map((line) => ({
            lineId: line.id,
            voucherId: line.voucher.id,
            type: line.voucher.type,
            reference: line.voucher.reference,
            date: line.voucher.date,
            partyName: readPartyName(line.voucher.partyJson),
            partyType: line.voucher.partyType,
            partyId: line.voucher.partyId,
            quantity: toNumber(line.quantity),
            rate: toNumber(line.rate),
            amount: toNumber(line.amount),
            unitCode: product.unit.code,
        }));

        // Synthetic opening-balance row — always prepended when openingStock > 0
        // so the user can see where their on-hand baseline came from. Dated to
        // openingStockDate (defaults to epoch when unset). Carries a negative
        // lineId / voucherId so the row never collides with a real voucher row.
        const openingQty = product.openingStock != null ? toNumber(product.openingStock) : 0;
        if (openingQty > 0) {
            const openingDate = product.openingStockDate ?? new Date(0);
            // Honour the period filter when an explicit openingStockDate is set
            // and falls fully outside the window; otherwise always show it.
            const dateOk = product.openingStockDate == null
                || ((!from || openingDate >= from) && (!to || openingDate <= to))
                || (to && openingDate < to);
            if (dateOk) {
                transactions.push({
                    lineId:    -product.id,           // unique synthetic key, never collides
                    voucherId: -1,                    // no real voucher → editFormUrl returns null
                    type:      "OPENING",
                    reference: "Opening balance",
                    date:      openingDate,
                    partyName: null,
                    partyType: null,
                    partyId:   null,
                    quantity:  openingQty,
                    rate:      product.openingRate != null ? toNumber(product.openingRate) : 0,
                    amount:    product.openingValue != null ? toNumber(product.openingValue) : 0,
                    unitCode:  product.unit.code,
                    paymentStatus: "N/A",   // suppress the receivables/payables badge
                });
                // Keep newest-first ordering; opening usually slides to the bottom.
                transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
            }
        }

        return NextResponse.json({
            product: { ...product, stock: live.total, branchStocks, lastPurchasePaise },
            transactions,
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch product transactions");
    }
}
