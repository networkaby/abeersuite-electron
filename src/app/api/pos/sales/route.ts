// GET /api/pos/sales
//
// Paginated list of POS sales — InvVouchers with type=SALE, most recent first.
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
            type:   "SALE" as const,
            status: "POSTED" as const,
            ...(q ? {
                OR: [
                    { reference:   { contains: q, mode: "insensitive" as const } },
                    { description: { contains: q, mode: "insensitive" as const } },
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
                    reference:      true,
                    date:           true,
                    description:    true,
                    paymentMode:    true,
                    totalAmount:    true,
                    amountReceived: true,
                    branch:         { select: { id: true, name: true } },
                    createdBy:      { select: { name: true } },
                    _count:         { select: { lines: true } },
                },
            }),
        ]);

        return NextResponse.json({
            total,
            items: vouchers.map((v) => ({
                id:             v.id,
                reference:      v.reference,
                date:           v.date,
                description:    v.description,
                paymentMode:    v.paymentMode,
                totalAmount:    v.totalAmount.toString(),
                amountReceived: v.amountReceived.toString(),
                branch:         v.branch?.name ?? "—",
                cashier:        v.createdBy?.name ?? "—",
                lineCount:      v._count.lines,
            })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load POS sales");
    }
}
