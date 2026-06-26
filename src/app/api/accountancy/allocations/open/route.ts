import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { sumReceiptAllocationsByJe } from "@/modules/accountancy/lib/outstandings";
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
            accountId,
            type:      { in: ["SALE", "POS", "PURCHASE"] },
            status:    "POSTED",
            deletedAt: null,
        },
        select: {
            id: true, type: true, reference: true, date: true,
            totalAmount: true,
            accountId: true,
            tenders: { select: { accountId: true, amount: true } },
            journalEntryId: true, creditPeriodDays: true,
        },
        orderBy: [{ date: "asc" }],
    });
    const jeIds = invVouchers
        .map((v) => v.journalEntryId)
        .filter((x): x is number => x !== null);
    // RECEIPT settlements via the universal-voucher spine (keyed by JE id).
    const jeAllocSum = await sumReceiptAllocationsByJe(prisma, jeIds);

    const openInvoices = invVouchers
        .map((v) => {
            const total = Number(v.totalAmount);
            // Paid at sale time = non-AR tender rows (cash/bank/card).
            // Later receipts add via the JE-allocation chain.
            const upfront = v.tenders
                .filter((t) => t.accountId !== v.accountId)
                .reduce((s, t) => s + Number(t.amount), 0);
            const allocated = upfront + (v.journalEntryId !== null ? (jeAllocSum[v.journalEntryId] ?? 0) : 0);
            const due = new Date(v.date);
            due.setDate(due.getDate() + (v.creditPeriodDays ?? 30));
            return {
                kind:        "invoice" as const, // keep the wire key the dialog already consumes
                id:          v.id,
                reference:   v.reference,
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
    const vouchers = await prisma.voucher.findMany({
        where: {
            partyAccountId: accountId,
            type:           { in: ["CREDIT_NOTE", "DEBIT_NOTE"] },
            deletedAt:      null,
            status:         { not: "CANCELLED" },
        },
        select: { id: true, type: true, reference: true, date: true, totalAmount: true },
        orderBy: [{ date: "asc" }],
    });
    const vchIds = vouchers.map((v) => v.id);
    const vchAllocs = vchIds.length > 0 ? await prisma.voucherAllocation.findMany({
        where: { targetType: "VOUCHER", targetId: { in: vchIds } },
        select: { targetId: true, amount: true },
    }) : [];
    const vchAllocSum = vchAllocs.reduce<Record<number, number>>((acc, a) => {
        acc[a.targetId] = (acc[a.targetId] ?? 0) + Number(a.amount);
        return acc;
    }, {});

    const openVouchers = vouchers
        .map((v) => ({
            kind:        "voucher" as const,
            id:          v.id,
            voucherType: v.type,
            reference:   v.reference,
            date:        v.date,
            totalAmount: Number(v.totalAmount),
            allocated:   vchAllocSum[v.id] ?? 0,
            outstanding: Number(v.totalAmount) - (vchAllocSum[v.id] ?? 0),
        }))
        .filter((row) => row.outstanding > 0.005);

    return NextResponse.json({
        openInvoices,
        openVouchers,
        openTotal: openInvoices.reduce((s, r) => s + r.outstanding, 0)
                 + openVouchers.reduce((s, r) => s + r.outstanding, 0),
    });
}
