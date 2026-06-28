// GET /api/pos/sales
//
// Paginated list of POS sales — InvVouchers with type=POS, most recent first.
//
// Query params (all optional):
//   ?limit=50    — page size (max 200, default 50)
//   ?page=1      — 1-based page
//   ?q=          — substring search on voucher reference or customer name
//   ?from=YYYY-MM-DD
//   ?to=YYYY-MM-DD
//
// Requires: pos:shift:open

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { handleApiError, parsePagination } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const url  = new URL(req.url);
    const q    = url.searchParams.get("q")?.trim() ?? "";
    const from = url.searchParams.get("from");
    const to   = url.searchParams.get("to");
    const { take, skip } = parsePagination(url.searchParams);

    try {
        const where = {
            type:   "POS" as const,
            status: "POSTED" as const,
            ...(q ? {
                OR: [
                    { universalVoucher: { friendlyRef:  { contains: q, mode: "insensitive" as const } } },   // 5D-6
                    { universalVoucher: { description:   { contains: q, mode: "insensitive" as const } } },   // 5D-5
                ],
            } : {}),
            ...(from || to ? {
                date: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to   ? { lte: new Date(to + "T23:59:59.999Z") } : {}),
                },
            } : {}),
        };

        const [total, vouchers] = await Promise.all([
            prisma.invVoucher.count({ where }),
            prisma.invVoucher.findMany({
                where,
                orderBy: { date: "desc" },
                take,
                skip,
                select: {
                    id:             true,
                    date:           true,
                    totalAmount:    true,
                    branch:         { select: { id: true, name: true } },
                    universalVoucher: { select: { createdById: true, partyAccountId: true, description: true, friendlyRef: true } },   // 5D-2/4/5/6
                    universalVoucherId: true,
                    settlementJson: true,
                },
            }),
        ]);

        // Phase 5 5C: goods lines hang off the spine — batch line counts.
        const uvIds = vouchers.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
        const lineCounts = uvIds.length === 0 ? [] : await prisma.voucherInventoryLine.groupBy({
            by: ["universalVoucherId"], where: { universalVoucherId: { in: uvIds } }, _count: { _all: true },
        });
        const lineCountByUv = new Map(lineCounts.map((c) => [c.universalVoucherId, c._count._all]));

        // 5D-2: resolve cashier (creator) names from each row's spine createdById.
        const creatorIds = [...new Set(vouchers.map((v) => v.universalVoucher?.createdById).filter((x): x is number => x != null))];
        const cashierById = new Map(
            (creatorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }))
                .map((u) => [u.id, u.name]),
        );

        return NextResponse.json({
            total,
            items: vouchers.map((v) => {
                // Tender input from settlementJson (G4b).
                const tenders = readSettlement(v.settlementJson).tenders;
                // Paid-at-counter = sum of non-AR tenders (cash/bank/card).
                // The AR tender (if any) sits as customer credit going forward.
                const paid = tenders
                    .filter((t) => t.accountId !== v.universalVoucher?.partyAccountId)
                    .reduce((s, t) => s + Number(t.amount), 0);
                // paymentMode equivalent: first tender's method, or "MIXED" when
                // the cashier used more than one channel.
                const methods = [...new Set(tenders.map((t) => t.method).filter((m): m is NonNullable<typeof m> => !!m))];
                const paymentMode = methods.length > 1 ? "MIXED" : (methods[0] ?? null);
                return {
                    id:             v.id,
                    reference:      v.universalVoucher?.friendlyRef ?? "",
                    date:           v.date,
                    description:    v.universalVoucher?.description ?? "",
                    paymentMode,
                    totalAmount:    v.totalAmount.toString(),
                    amountReceived: paid.toFixed(2),
                    branch:         v.branch?.name ?? "—",
                    cashier:        (v.universalVoucher?.createdById != null ? cashierById.get(v.universalVoucher.createdById) : null) ?? "—",
                    lineCount:      v.universalVoucherId != null ? (lineCountByUv.get(v.universalVoucherId) ?? 0) : 0,
                };
            }),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load POS sales");
    }
}
