// GET /api/accountancy/reports/pending-stock
// Aggregates line items from all unsettled pending vouchers (CHALLAN, GRN,
// REJECTION_IN, REJECTION_OUT) grouped by product, so the caller can see
// which inventory is in transit / not yet settled.
// Settlement rules live in shared/lib/accountancy/settlementMatrix.ts (shared with /pending-vouchers).

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { voucherDisplayNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { auth } from "@/auth";
import { VoucherStatus, type Prisma } from "@/generated/prisma/client";
import { PENDING_TYPES, OUT_TYPES, unsettledClause, type PendingType } from "@/shared/lib/accountancy/settlementMatrix";
import { businessToday } from "@/shared/lib/format/formatDate";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);

    const from        = searchParams.get("from");
    const to          = searchParams.get("to");
    const branchParam = searchParams.get("branchId");

    let branchScopeId: string | undefined;
    if (branchParam && branchParam !== "all") {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return branchAccessResponse(e);
            throw e;
        }
        branchScopeId = branchParam;
    }

    // 5D-8/5D-10/5D-12: status/deletedAt + date + branch all live on the spine.
    const where: Prisma.VoucherDetailWhereInput = {
        universalVoucher: {
            status: VoucherStatus.POSTED,
            deletedAt: null,
            ...(branchScopeId ? { branchId: branchScopeId } : {}),
            ...((from || to) ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
        },
        OR: PENDING_TYPES.map(unsettledClause),
    };

    const voucherRows = await prisma.voucherDetail.findMany({
        where,
        orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }],   // 5D-10
        include: { universalVoucher: { select: { voucherNo: true, date: true, type: true, branchId: true, branch: { select: { id: true, name: true } } } } },   // 5D-6 + 5D-10 date + 5D-11 type + 5D-12 branch
    });
    // Phase 5 5C: goods lines hang off the spine — batch-load + group by spine id.
    const uvIds = voucherRows.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const allLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: { in: uvIds } },
        include: { product: { select: { id: true, sku: true, name: true, unit: { select: { code: true } } } } },
    });
    const linesByUv = new Map<number, typeof allLines>();
    for (const l of allLines) {
        const arr = linesByUv.get(l.universalVoucherId) ?? [];
        arr.push(l); linesByUv.set(l.universalVoucherId, arr);
    }
    const vouchers = voucherRows.map((v) => ({
        ...v,
        lines: v.universalVoucherId != null ? (linesByUv.get(v.universalVoucherId) ?? []) : [],
    }));

    const today = businessToday();

    type StockLine = {
        voucherId:  number;
        reference:  string;
        type:       string;
        date:       string;
        quantity:   number;
        direction:  "in" | "out";
        branchId:   string;
        branchName: string | null;
        daysOpen:   number;
    };

    const productMap = new Map<number, {
        productId:    number;
        productName:  string;
        productSku:   string;
        unitCode:     string;
        totalIn:      number;
        totalOut:     number;
        pendingLines: StockLine[];
    }>();

    for (const v of vouchers) {
        const direction: "in" | "out" = OUT_TYPES.has(v.universalVoucher!.type as PendingType) ? "out" : "in";   // 5D-11
        const d = new Date(v.universalVoucher!.date); d.setHours(0, 0, 0, 0);   // 5D-10: date on spine
        const daysOpen = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000));

        for (const l of v.lines) {
            const qty = Number(l.quantity);
            if (qty <= 0) continue;

            let entry = productMap.get(l.productId);
            if (!entry) {
                entry = {
                    productId:    l.productId,
                    productName:  l.product.name,
                    productSku:   l.product.sku,
                    unitCode:     l.product.unit.code,
                    totalIn:      0,
                    totalOut:     0,
                    pendingLines: [],
                };
                productMap.set(l.productId, entry);
            }

            if (direction === "in") entry.totalIn  += qty;
            else                    entry.totalOut += qty;

            entry.pendingLines.push({
                voucherId:  v.id,
                reference:  voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId),
                type:       v.universalVoucher!.type,   // 5D-11
                date:       v.universalVoucher!.date.toISOString(),   // 5D-10
                quantity:   qty,
                direction,
                branchId:   v.universalVoucher!.branchId ?? "",
                branchName: v.universalVoucher?.branch?.name ?? null,
                daysOpen,
            });
        }
    }

    const rows = [...productMap.values()]
        .sort((a, b) => a.productName.localeCompare(b.productName));

    return NextResponse.json({ rows });
}
