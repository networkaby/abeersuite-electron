import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { sumReceiptAllocations, loadTenderLines, sumVoucherAllocations } from "@/modules/accountancy/lib/outstandings";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/accountancy/allocations/open?accountId=N
// Returns InvVoucher (SALE/POS/PURCHASE) and finance Voucher (CREDIT_NOTE /
// DEBIT_NOTE) rows tied to the given party account that still have an
// outstanding amount (totalAmount − Σ allocations targeting this row).
//
// Used by the bill-wise drawer when entering a Receipt or Payment voucher
// to show which open bills can be settled.
//
// Migrated from prisma.invoice to prisma.invVoucher on 2026-05-24 as part
// of the Invoice → InvVoucher consolidation (Layer 3e). Allocations target
// the InvVoucher's `journalEntryId` (the canonical receipts-engine link),
// not the InvVoucher id directly.
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") ? Number(searchParams.get("accountId")) : null;
    if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

    // ── InvVoucher bills (SALE / POS / PURCHASE) for the party ────────────
    const invVouchers = await prisma.invVoucher.findMany({
        where: {
            universalVoucher: { partyAccountId: accountId },   // 5D-4: party on spine
            type:      { in: ["SALE", "POS", "PURCHASE"] },
            status:    "POSTED",
            deletedAt: null,
        },
        select: {
            id: true, type: true, date: true,
            totalAmount: true,
            universalVoucher: { select: { partyAccountId: true, voucherNo: true } },   // 5D-4 + 5D-6
            universalVoucherId: true, creditPeriodDays: true,
        },
        orderBy: [{ date: "asc" }],
    });
    const uvIds = invVouchers
        .map((v) => v.universalVoucherId)
        .filter((x): x is number => x !== null);
    // RECEIPT settlements + up-front tenders, both via the spine (universalVoucherId).
    const [jeAllocSum, tendersBySpine] = await Promise.all([
        sumReceiptAllocations(prisma, uvIds),
        loadTenderLines(prisma, uvIds),
    ]);

    const openInvoices = invVouchers
        .map((v) => {
            const total = Number(v.totalAmount);
            // Paid at sale time = non-AR tender rows (cash/bank/card).
            // Later receipts add via the spine-allocation chain.
            const upfront = (v.universalVoucherId !== null ? (tendersBySpine.get(v.universalVoucherId) ?? []) : [])
                .filter((t) => t.accountId !== v.universalVoucher?.partyAccountId)
                .reduce((s, t) => s + t.amount, 0);
            const allocated = upfront + (v.universalVoucherId !== null ? (jeAllocSum[v.universalVoucherId] ?? 0) : 0);
            const due = new Date(v.date);
            due.setDate(due.getDate() + (v.creditPeriodDays ?? 30));
            return {
                kind:        "invoice" as const, // keep the wire key the dialog already consumes
                id:          v.id,
                reference:   v.universalVoucher?.voucherNo ?? "",
                date:        v.date,
                dueDate:     due,
                totalAmount: total,
                allocated,
                outstanding: total - allocated,
            };
        })
        .filter((row) => row.outstanding > 0.005);

    // ── Finance Voucher bills (CREDIT_NOTE / DEBIT_NOTE) for the party ────
    // RECEIPT/PAYMENT are settlements, not bills — they appear as the
    // source side of an allocation, not the target side. Same logic as
    // outstandings.ts post-2026-05-24.
    // Phase 5 5E: the spine IS the finance voucher; total is computed from the
    // debit legs (no stored totalAmount).
    const vouchers = await prisma.universalVoucher.findMany({
        where: {
            partyAccountId: accountId,
            type:           { in: ["CREDIT_NOTE", "DEBIT_NOTE"] },
            deletedAt:      null,
            status:         { not: "CANCELLED" },
        },
        select: { id: true, type: true, reference: true, date: true, lines: { select: { type: true, amount: true } } },
        orderBy: [{ date: "asc" }],
    });
    const vchIds = vouchers.map((v) => v.id);
    // 5E: CREDIT_NOTE/DEBIT_NOTE settlements via the spine (keyed by spine id).
    const vchAllocSum = await sumVoucherAllocations(prisma, vchIds);

    const openVouchers = vouchers
        .map((v) => {
            const total = v.lines.filter((l) => l.type === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
            return {
                kind:        "voucher" as const,
                id:          v.id,
                voucherType: v.type,
                reference:   v.reference,
                date:        v.date,
                totalAmount: total,
                allocated:   vchAllocSum[v.id] ?? 0,
                outstanding: total - (vchAllocSum[v.id] ?? 0),
            };
        })
        .filter((row) => row.outstanding > 0.005);

    return NextResponse.json({
        openInvoices,
        openVouchers,
        openTotal: openInvoices.reduce((s, r) => s + r.outstanding, 0)
                 + openVouchers.reduce((s, r) => s + r.outstanding, 0),
    });
}
