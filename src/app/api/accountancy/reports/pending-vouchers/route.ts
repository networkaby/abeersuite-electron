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
import { partyLinkFields } from "@/shared/lib/parties/partyLink";
import { resolvePartyLinks } from "@/shared/lib/parties/partyLinkServer";
import { voucherDisplayNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { VoucherStatus, type Prisma } from "@/generated/prisma/client";
import { PENDING_TYPES, unsettledClause, type PendingType } from "@/shared/lib/accountancy/settlementMatrix";
import { requireBranchAccess, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { auth } from "@/auth";
import { readPartyName } from "@/shared/lib/accountancy/partySnapshot";
import { businessToday } from "@/shared/lib/format/formatDate";

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
    let branchScopeId: string | undefined;
    if (branchParam === "all" || !branchParam) {
        // No branch filter — org-wide.
    } else {
        try { requireBranchAccess(session, branchParam); } catch (e) {
            if (e instanceof BranchAccessError) return branchAccessResponse(e);
            throw e;
        }
        branchScopeId = branchParam;
    }

    // Type filter — narrow to one pending type, or OR-combine all four.
    const typesToInclude: PendingType[] =
        typeParam && (PENDING_TYPES as string[]).includes(typeParam)
            ? [typeParam as PendingType]
            : PENDING_TYPES;

    // 5D-4: live party-ledger name search resolves account ids first, then matches
    // the spine's partyAccountId (the spine has no account relation).
    const searchPartyAcctIds = search
        ? (await prisma.account.findMany({ where: { name: { contains: search, mode: "insensitive" } }, select: { id: true } })).map((a) => a.id)
        : [];

    const where: Prisma.VoucherDetailWhereInput = {
        // 5D-8/5D-10/5D-12: status + date + branch all live on the spine.
        universalVoucher: {
            status: VoucherStatus.POSTED,
            ...(branchScopeId ? { branchId: branchScopeId } : {}),
            ...((from || to) ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
        },
        OR:        typesToInclude.map(unsettledClause),
        ...(search && {
            AND: [{
                OR: [
                    { universalVoucher: { voucherNo:  { contains: search, mode: "insensitive" } } },   // 5D-6: ref on spine
                    { universalVoucher: { description: { contains: search, mode: "insensitive" } } },   // 5D-5: description on spine
                    // Party search: live ledger name (via resolved ids) OR the frozen
                    // snapshot name (for walk-ins with no account).
                    ...(searchPartyAcctIds.length ? [{ universalVoucher: { partyAccountId: { in: searchPartyAcctIds } } }] : []),
                    { partyJson: { path: ["name"], string_contains: search } },
                ],
            }],
        }),
    };

    const [total, rowsRaw] = await Promise.all([
        prisma.voucherDetail.count({ where }),
        prisma.voucherDetail.findMany({
            where,
            orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }], // oldest first — drives attention (5D-10)
            skip:    (page - 1) * limit,
            take:    limit,
            include: {
                universalVoucher: { select: { description: true, voucherNo: true, date: true, type: true, branch: { select: { id: true, name: true } } } },   // 5D-5 desc + 5D-6 ref + 5D-10 date + 5D-11 type + 5D-12 branch
            },
        }),
    ]);
    // Phase 5 5C: goods lines hang off the spine — batch-load + group by spine id.
    const uvIds = rowsRaw.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
    const allLines = await prisma.voucherInventoryLine.findMany({
        where:   { universalVoucherId: { in: uvIds } },
        include: { product: { select: { id: true, sku: true, name: true } } },
    });
    const linesByUv = new Map<number, typeof allLines>();
    for (const l of allLines) {
        const arr = linesByUv.get(l.universalVoucherId) ?? [];
        arr.push(l); linesByUv.set(l.universalVoucherId, arr);
    }
    const rows = rowsRaw.map((v) => ({
        ...v,
        lines: v.universalVoucherId != null ? (linesByUv.get(v.universalVoucherId) ?? []) : [],
    }));

    // One bounded pass resolves every party id to its Person/Company profile link
    // for the Party cell.
    const partyLinks = await resolvePartyLinks(prisma, rows);

    const today = businessToday();
    const shaped = rows.map((v) => {
        const d = new Date(v.universalVoucher!.date); d.setHours(0, 0, 0, 0);   // 5D-10: date on spine
        const daysOpen = Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000));
        return {
            id:          v.id,
            reference:   voucherDisplayNo(v.universalVoucher?.voucherNo, v.universalVoucherId),
            type:        v.universalVoucher!.type,   // 5D-11
            date:        v.universalVoucher!.date,   // 5D-10
            partyId:     v.partyId,
            partyType:   v.partyType,
            partyName:   readPartyName(v.partyJson),
            ...partyLinkFields(partyLinks.for(v)),
            description: v.universalVoucher?.description ?? "",
            totalAmount: Number(v.totalAmount),
            lineCount:   v.lines.length,
            branchName:  v.universalVoucher?.branch?.name ?? null,
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
