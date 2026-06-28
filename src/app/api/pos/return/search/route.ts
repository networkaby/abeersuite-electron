// GET /api/pos/return/search
//
// Two lookup modes, both return the same `FoundInvoice[]` shape so the
// PosReturnDialog UI is uniform:
//
//   ?q=POS-…/SV-…  — voucher-reference substring search (cashier types it)
//   ?customerId=N  — every POS/SALE InvVoucher for that customer account
//                    (used when the customer has lost the original receipt)
//
// Returns POS + SALE InvVouchers only — never SALE_RETURN (no return of a
// return) and never DRAFT/CANCELLED/deleted rows. The `id` and per-line
// `id` in the response point to InvVoucher / InvVoucherLine since the
// 2026-05-24 Invoice→InvVoucher consolidation; the field names are kept
// for client-side API back-compat — the dialog treats them as opaque IDs.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const url        = new URL(req.url);
    const q          = url.searchParams.get("q")?.trim() ?? "";
    const customerId = url.searchParams.get("customerId");

    if (!q && !customerId) {
        return NextResponse.json({ error: "Pass either q=<invoice#> or customerId=<accountId>" }, { status: 400 });
    }
    if (q && q.length < 2) {
        return NextResponse.json({ error: "Enter at least 2 characters" }, { status: 400 });
    }

    try {
        const vouchers = await prisma.invVoucher.findMany({
            where: {
                type:      { in: ["POS", "SALE"] },
                // 5D-8: status + deletedAt live on the spine; party (5D-4) + the
                // voucher-number search (5D-6 voucherNo) also resolve via the spine.
                universalVoucher: {
                    status:    "POSTED",
                    deletedAt: null,
                    ...(customerId
                        ? { partyAccountId: Number(customerId) }
                        : { voucherNo: { contains: q, mode: "insensitive" } }),
                },
            },
            orderBy: { universalVoucher: { date: "desc" } },   // 5D-10
            take:    10,
            include: {
                universalVoucher: { select: { partyAccountId: true, voucherNo: true, date: true } },   // 5D-4 party + 5D-6 ref + 5D-10 date
                // SALE_RETURN children of this voucher — for the dialog's "already returned" guard
                refReturns: { select: { id: true, totalAmount: true, universalVoucher: { select: { voucherNo: true } } } },
            },
        });
        // 5D-4: resolve party ledger names from each row's spine partyAccountId.
        const partyAcctIds = [...new Set(vouchers.map((v) => v.universalVoucher?.partyAccountId).filter((x): x is number => x != null))];
        const partyAcctById = new Map(
            (partyAcctIds.length === 0 ? [] : await prisma.account.findMany({ where: { id: { in: partyAcctIds } }, select: { id: true, name: true } }))
                .map((a) => [a.id, a]),
        );
        // Phase 5 5C: goods lines hang off the spine — batch-load + group by spine id.
        const uvIds = vouchers.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
        const allLines = await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: { in: uvIds } },
            select:  { id: true, universalVoucherId: true, productId: true, description: true, quantity: true, rate: true, taxRate: true, taxAmount: true, amount: true, product: { select: { id: true, name: true, sku: true } } },
        });
        const linesByUv = new Map<number, typeof allLines>();
        for (const l of allLines) {
            const arr = linesByUv.get(l.universalVoucherId) ?? [];
            arr.push(l); linesByUv.set(l.universalVoucherId, arr);
        }
        const linesFor = (v: { universalVoucherId: number | null }) =>
            v.universalVoucherId != null ? (linesByUv.get(v.universalVoucherId) ?? []) : [];

        return NextResponse.json(vouchers.map((v) => ({
            id:          v.id,
            number:      v.universalVoucher?.voucherNo ?? "",
            issueDate:   v.universalVoucher?.date,   // 5D-10: date on spine
            status:      "PAID", // legacy field — POS sales are always settled at counter; UI uses it as a "OK to return" sentinel
            totalAmount: v.totalAmount.toString(),
            account:     v.universalVoucher?.partyAccountId != null ? (partyAcctById.get(v.universalVoucher.partyAccountId) ?? null) : null,
            lines:       linesFor(v).map((l) => ({
                id:          l.id,
                productId:   l.productId,
                description: l.description ?? "",
                quantity:    l.quantity.toString(),
                unitPrice:   l.rate.toString(),
                taxRate:     l.taxRate?.toString() ?? "0",
                taxAmount:   l.taxAmount?.toString() ?? "0",
                amount:      l.amount.toString(),
                product:     l.product,
            })),
            returns: v.refReturns.map((r) => ({
                id:          r.id,
                number:      r.universalVoucher?.voucherNo ?? "",
                totalAmount: r.totalAmount.toString(),
            })),
        })));
    } catch (e) {
        return handleApiError(e, "Failed to search invoices");
    }
}
