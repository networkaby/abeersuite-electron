// GET /api/inventory/vouchers/optional
// Consolidated listing of the six non-GL ("optional" in Tally parlance)
// inventory voucher types: Sales Order, Purchase Order, GRN, Challan,
// Rejection In, Rejection Out. Modeled after Day Book's report endpoint —
// date-range, paginated, optional kind + search filters.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { InvVoucherType, type Prisma } from "@/generated/prisma/client";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";

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
        // 5D-4: live party-ledger name search resolves account ids first, then
        // matches the spine's partyAccountId (the spine has no account relation).
        const partyAcctIds = (await prisma.account.findMany({
            where: { name: { contains: search, mode: "insensitive" } }, select: { id: true },
        })).map((a) => a.id);
        where.OR = [
            { universalVoucher: { voucherNo:  { contains: search, mode: "insensitive" } } },   // 5D-6: ref on spine
            { universalVoucher: { description: { contains: search, mode: "insensitive" } } },   // 5D-5: description on spine
            ...(partyAcctIds.length ? [{ universalVoucher: { partyAccountId: { in: partyAcctIds } } }] : []),
            { partyJson: { path: ["name"], string_contains: search } },
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
                refVoucher: { select: { id: true, type: true, universalVoucher: { select: { voucherNo: true } } } },
                universalVoucher: { select: { description: true, voucherNo: true } },   // 5D-5 desc + 5D-6 ref
            },
        }),
    ]);
    // Phase 5 5C: goods lines hang off the spine — batch-load + group by spine id.
    const uvIds = rows.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const allLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: { in: uvIds } },
        include: { product: { select: { id: true, sku: true, name: true } } },
    });
    const linesByUv = new Map<number, typeof allLines>();
    for (const l of allLines) {
        const arr = linesByUv.get(l.universalVoucherId) ?? [];
        arr.push(l); linesByUv.set(l.universalVoucherId, arr);
    }
    const linesFor = (v: { universalVoucherId: number | null }) =>
        v.universalVoucherId != null ? (linesByUv.get(v.universalVoucherId) ?? []) : [];

    const shaped = rows.map((v) => ({
        id:          v.id,
        date:        v.date,
        type:        v.type,
        reference:   v.universalVoucher?.voucherNo ?? "",
        description: v.universalVoucher?.description ?? "",
        partyName:   readPartyName(v.partyJson),
        partyType:   v.partyType,
        partyId:     v.partyId,
        status:      v.status,
        deletedAt:   v.deletedAt,
        totalAmount: Number(v.totalAmount),
        stockDir:    STOCK_IN_TYPES.has(v.type) ? "IN"
                   : STOCK_OUT_TYPES.has(v.type) ? "OUT"
                   : "NONE",
        refVoucher: v.refVoucher ? { id: v.refVoucher.id, type: v.refVoucher.type, reference: v.refVoucher.universalVoucher?.voucherNo ?? "" } : null,
        lineCount:  linesFor(v).length,
        lines: linesFor(v).map((l) => ({
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
