import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/finance/allocations/open?accountId=N
// Returns invoices/vouchers tied to the given party account that still have
// outstanding amount (totalAmount − Σ allocations linked to this row as target).
//
// Used by the bill-wise drawer when entering a Receipt or Payment voucher
// to show which open bills can be settled.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") ? Number(searchParams.get("accountId")) : null;
    if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

    // Pull invoices for the account
    const invoices = await prisma.invoice.findMany({
        where: { accountId, deletedAt: null, status: { not: "VOID" } },
        select: {
            id: true, number: true, issueDate: true, dueDate: true, totalAmount: true, status: true,
        },
        orderBy: [{ issueDate: "asc" }],
    });

    // Pull existing allocations against these invoices (target side)
    const invIds = invoices.map((i) => i.id);
    const invAllocs = invIds.length > 0 ? await prisma.voucherAllocation.findMany({
        where: { targetType: "INVOICE", targetId: { in: invIds } },
        select: { targetId: true, amount: true },
    }) : [];
    const invAllocSum = invAllocs.reduce<Record<number, number>>((acc, a) => {
        acc[a.targetId] = (acc[a.targetId] ?? 0) + Number(a.amount);
        return acc;
    }, {});

    const openInvoices = invoices
        .map((inv) => ({
            kind:        "invoice" as const,
            id:          inv.id,
            reference:   inv.number,
            date:        inv.issueDate,
            dueDate:     inv.dueDate,
            totalAmount: Number(inv.totalAmount),
            allocated:   invAllocSum[inv.id] ?? 0,
            outstanding: Number(inv.totalAmount) - (invAllocSum[inv.id] ?? 0),
        }))
        .filter((row) => row.outstanding > 0.005);

    // Same shape for Voucher rows where the voucher has the account as party.
    const vouchers = await prisma.voucher.findMany({
        where: { partyAccountId: accountId, deletedAt: null, status: { not: "CANCELLED" } },
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
