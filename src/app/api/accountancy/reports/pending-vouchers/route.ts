// GET /api/accountancy/reports/pending-vouchers
// Lists POSTED inventory-in-flight vouchers (CHALLAN, GRN, REJECTION_IN, REJECTION_OUT)
// that have no active settling voucher pointing at them via refVoucherId.
//
// Settlement rules (per voucher taxonomy):
//   CHALLAN       → settled by SALE         or REJECTION_IN
//   GRN           → settled by PURCHASE     or REJECTION_OUT
//   REJECTION_IN  → settled by CHALLAN      or SALE_RETURN
//   REJECTION_OUT → settled by GRN          or PURCHASE_RETURN
// CREDIT_NOTE / DEBIT_NOTE (GL-only) do NOT count as settlement here.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { InvVoucherType, VoucherStatus, type Prisma } from "@/generated/prisma/client";
import { requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";

type PendingType =
    | "CHALLAN" | "GRN" | "REJECTION_IN" | "REJECTION_OUT";

const SETTLES_BY: Record<PendingType, InvVoucherType[]> = {
    CHALLAN:       [InvVoucherType.SALE,     InvVoucherType.REJECTION_IN],
    GRN:           [InvVoucherType.PURCHASE, InvVoucherType.REJECTION_OUT],
    REJECTION_IN:  [InvVoucherType.CHALLAN,  InvVoucherType.SALE_RETURN],
    REJECTION_OUT: [InvVoucherType.GRN,      InvVoucherType.PURCHASE_RETURN],
};

const PENDING_TYPES = Object.keys(SETTLES_BY) as PendingType[];

// Build a per-type "where" clause: type + unsettled.
function unsettledClause(type: PendingType): Prisma.InvVoucherWhereInput {
    return {
        type: InvVoucherType[type],
        refReturns: {
            none: {
                status: { not: VoucherStatus.CANCELLED },
                type:   { in: SETTLES_BY[type] },
            },
        },
    };
}

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    const session = await auth();
    const { searchParams } = new URL(req.url);

    const typeParam = searchParams.get("type");
    const from      = searchParams.get("from");
    const to        = searchParams.get("to");
    const search    = searchParams.get("search")?.trim() ?? "";
    const page      = Math.max(1, Number(searchParams.get("page")  ?? "1"));
    const limit     = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));
    const branchParam = searchParams.get("branchId");

    // Branch filter — reports default to org-wide. Pass `branchId=<id>` to
    // scope to a specific branch (with access check), or omit / `=all` for
    // org-wide. The top-bar working-branch cookie is intentionally NOT used.
    let branchFilter: { branchId?: string } = {};
    if (branchParam === "all" || !branchParam) {
        // No branch filter — org-wide.
    } else {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 403 });
            throw e;
        }
        branchFilter = { branchId: branchParam };
    }

    // Type filter — narrow to one pending type, or OR-combine all four.
    const typesToInclude: PendingType[] =
        typeParam && (PENDING_TYPES as string[]).includes(typeParam)
            ? [typeParam as PendingType]
            : PENDING_TYPES;

    const where: Prisma.InvVoucherWhereInput = {
        status:    VoucherStatus.POSTED,
        deletedAt: null,
        OR:        typesToInclude.map(unsettledClause),
        ...branchFilter,
        ...((from || to) && {
            date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to   ? { lte: new Date(to)   } : {}),
            },
        }),
        ...(search && {
            AND: [{
                OR: [
                    { reference:   { contains: search, mode: "insensitive" } },
                    { description: { contains: search, mode: "insensitive" } },
                    { partyName:   { contains: search, mode: "insensitive" } },
                ],
            }],
        }),
    };

    const [total, rows] = await Promise.all([
        prisma.invVoucher.count({ where }),
        prisma.invVoucher.findMany({
            where,
            orderBy: [{ date: "asc" }, { id: "asc" }], // oldest first — drives attention
            skip:    (page - 1) * limit,
            take:    limit,
            include: {
                _count: { select: { lines: true } },
                branch: { select: { id: true, name: true } },
                lines: {
                    include: {
                        product: { select: { id: true, sku: true, name: true } },
                    },
                },
            },
        }),
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const shaped = rows.map((v) => {
        const d = new Date(v.date); d.setHours(0, 0, 0, 0);
        const daysOpen = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000));
        return {
            id:          v.id,
            reference:   v.reference,
            type:        v.type,
            date:        v.date,
            partyId:     v.partyId,
            partyName:   v.partyName,
            description: v.description,
            totalAmount: Number(v.totalAmount),
            lineCount:   v._count.lines,
            branchName:  v.branch?.name ?? null,
            daysOpen,
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
        };
    });

    return NextResponse.json({
        from: from ?? null,
        to:   to   ?? null,
        rows: shaped,
        total,
        page,
        limit,
    });
}
