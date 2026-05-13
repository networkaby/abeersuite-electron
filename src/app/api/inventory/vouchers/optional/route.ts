// GET /api/inventory/vouchers/optional
// Consolidated listing of the six non-GL ("optional" in Tally parlance)
// inventory voucher types: Sales Order, Purchase Order, GRN, Challan,
// Rejection In, Rejection Out. Modeled after Day Book's report endpoint —
// date-range, paginated, optional kind + search filters.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { InvVoucherType, type Prisma } from "@/generated/prisma/client";

const OPTIONAL_TYPES: InvVoucherType[] = [
    InvVoucherType.SALES_ORDER,
    InvVoucherType.PURCHASE_ORDER,
    InvVoucherType.GRN,
    InvVoucherType.CHALLAN,
    InvVoucherType.REJECTION_IN,
    InvVoucherType.REJECTION_OUT,
];

const STOCK_IN_TYPES = new Set<InvVoucherType>([
    InvVoucherType.GRN,
    InvVoucherType.REJECTION_IN,
]);
const STOCK_OUT_TYPES = new Set<InvVoucherType>([
    InvVoucherType.CHALLAN,
    InvVoucherType.REJECTION_OUT,
]);

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const from   = searchParams.get("from");
    const to     = searchParams.get("to");
    const type   = searchParams.get("type") as InvVoucherType | null;
    const search = searchParams.get("search")?.trim() ?? "";
    const page   = Math.max(1, Number(searchParams.get("page")  ?? "1"));
    const limit  = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));

    const where: Prisma.InvVoucherWhereInput = {
        type: type && (OPTIONAL_TYPES as string[]).includes(type)
            ? type
            : { in: OPTIONAL_TYPES },
        ...(from ? { date: { gte: new Date(from) } } : {}),
        ...(to   ? { date: { lte: new Date(to)   } } : {}),
        // Hide hard-deleted rows; cancelled / soft-deleted still surface
        // so users can audit the trail.
    };
    if (from || to) {
        where.date = {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
        };
    }
    if (search) {
        where.OR = [
            { reference:   { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { partyName:   { contains: search, mode: "insensitive" } },
        ];
    }

    const [total, rows] = await Promise.all([
        prisma.invVoucher.count({ where }),
        prisma.invVoucher.findMany({
            where,
            orderBy: [{ date: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
            include: {
                _count:     { select: { lines: true } },
                refVoucher: { select: { id: true, reference: true, type: true } },
                lines: {
                    include: {
                        product: { select: { id: true, sku: true, name: true } },
                    },
                },
            },
        }),
    ]);

    const shaped = rows.map((v) => ({
        id:          v.id,
        date:        v.date,
        type:        v.type,
        reference:   v.reference,
        description: v.description,
        partyName:   v.partyName,
        status:      v.status,
        deletedAt:   v.deletedAt,
        totalAmount: Number(v.totalAmount),
        stockDir:    STOCK_IN_TYPES.has(v.type) ? "IN"
                   : STOCK_OUT_TYPES.has(v.type) ? "OUT"
                   : "NONE",
        refVoucher: v.refVoucher,
        lineCount:  v._count.lines,
        lines: v.lines.map((l) => ({
            id:          l.id,
            productId:   l.productId,
            productName: l.product.name,
            productSku:  l.product.sku,
            description: l.description,
            quantity:    Number(l.quantity),
            rate:        Number(l.rate),
            amount:      Number(l.amount),
        })),
    }));

    return NextResponse.json({
        from: from ?? null,
        to:   to   ?? null,
        rows: shaped,
        total,
        page,
        limit,
    });
}
