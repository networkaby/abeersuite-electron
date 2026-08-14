// GET /api/pos/sales
//
// Paginated list of POS counter documents — most recent first.
//
// Query params (all optional):
//   ?kind=sale    — POS sales (InvVouchers with type=POS). [default]
//   ?kind=returns — counter-processed sale returns (SALE_RETURN raised by the
//                   POS Return dialog or the Lost-invoice return): a SALE_RETURN
//                   whose original (`refVoucher`) is a POS/SALE, or a lost-
//                   invoice return (no link; narration starts
//                   "Lost-invoice return —"). Office Sale Returns (no link,
//                   "Sale return from …") and online/ecommerce returns (link →
//                   ONLINE_INVOICE) stay out of the POS page.
//   ?limit=50    — page size (max 200, default 50)
//   ?page=1      — 1-based page
//   ?q=          — substring search on voucher reference or customer name
//   ?from=YYYY-MM-DD
//   ?to=YYYY-MM-DD
//
// Requires: pos:shift:open

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { readSettlement } from "@/shared/lib/accountancy/settlement";
import { handleApiError, parsePagination } from "@/shared/lib/api";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const kind = url.searchParams.get("kind")?.trim() === "returns" ? "returns" : "sale";
    const { take, skip } = parsePagination(url.searchParams);

    try {
        // 5D-8/5D-10: status + date live on the spine. (Typed so excess-property
        // drift is caught — the prior untyped literal silently kept status/date.)
        // Returns mode: ONLY counter-processed returns belong on the POS page —
        // a linked return (refVoucher → POS/SALE original) or a lost-invoice
        // return (no link, but marked in the narration). Office Sale Returns
        // and online/ecommerce returns never match these, so they stay out.
        const kindSpine: Prisma.UniversalVoucherWhereInput = {
            type: kind === "returns" ? "SALE_RETURN" : "POS",   // 5D-11
            status: "POSTED",
            ...(from || to ? {
                date: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to ? { lte: new Date(to + "T23:59:59.999Z") } : {}),
                },
            } : {}),
        };
        const returnFilter: Prisma.VoucherDetailWhereInput | null = kind === "returns" ? {
            OR: [
                { refVoucher: { universalVoucher: { type: { in: ["POS", "SALE"] } } } },
                {
                    refVoucherId: null,
                    universalVoucher: { description: { startsWith: "Lost-invoice return —" } },
                },
            ],
        } : null;
        const searchFilter: Prisma.VoucherDetailWhereInput | null = q ? {
            OR: [
                { universalVoucher: { voucherNo: { contains: q, mode: "insensitive" as const } } },   // 5D-6
                { universalVoucher: { description: { contains: q, mode: "insensitive" as const } } },   // 5D-5
            ],
        } : null;
        const extra = [returnFilter, searchFilter].filter((x): x is Prisma.VoucherDetailWhereInput => x != null);
        const where: Prisma.VoucherDetailWhereInput = {
            universalVoucher: kindSpine,
            ...(extra.length > 0 ? { AND: extra } : {}),
        };

        const [total, vouchers] = await Promise.all([
            prisma.voucherDetail.count({ where }),
            prisma.voucherDetail.findMany({
                where,
                orderBy: { universalVoucher: { date: "desc" } },   // 5D-10
                take,
                skip,
                select: {
                    id: true,
                    totalAmount: true,
                    universalVoucher: { select: { createdById: true, partyAccountId: true, description: true, voucherNo: true, date: true, branch: { select: { id: true, name: true } } } },   // 5D-2/4/5/6 + 5D-10 date + 5D-12 branch
                    universalVoucherId: true,
                    settlementJson: true,
                    // Original sale a POS return was raised against (SALE_RETURN has
                    // refVoucherId → the original POS/SALE). Null for lost-invoice.
                    refVoucher: { select: { universalVoucher: { select: { voucherNo: true } } } },
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
                // Return refund channel — the settlement tender's account is the
                // customer AR on a credit note, the counter till on a cash refund.
                const refundMode = tenders.length === 0 ? null
                    : tenders.some((t) => t.accountId === v.universalVoucher?.partyAccountId) ? "CREDIT" : "CASH";
                return {
                    id: v.id,
                    reference: v.universalVoucher?.voucherNo ?? "",
                    date: v.universalVoucher?.date,   // 5D-10: date on spine
                    description: v.universalVoucher?.description ?? "",
                    paymentMode,
                    refundMode: kind === "returns" ? refundMode : null,
                    originalRef: kind === "returns" ? (v.refVoucher?.universalVoucher?.voucherNo ?? null) : null,
                    totalAmount: v.totalAmount.toString(),
                    amountReceived: paid.toFixed(2),
                    branch: v.universalVoucher?.branch?.name ?? "—",
                    cashier: (v.universalVoucher?.createdById != null ? cashierById.get(v.universalVoucher.createdById) : null) ?? "—",
                    lineCount: v.universalVoucherId != null ? (lineCountByUv.get(v.universalVoucherId) ?? 0) : 0,
                };
            }),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load POS sales");
    }
}