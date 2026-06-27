// GET /api/pos/cash-movements
//
// Recent counter cash movements for the POS register's "Cash In/Out" tab:
// receipts collected from parties (the Rcv flow) and expenditures paid from the
// drawer (the Exp flow). Both are shift-linked (PosReceipt / PosExpenditure),
// which is what makes them definitively "counter" movements vs. office vouchers.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100));

        const shiftSelect = {
            select: { counter: { select: { name: true } }, user: { select: { name: true } } },
        } as const;

        const [receipts, expenditures] = await Promise.all([
            prisma.posReceipt.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { shift: shiftSelect } }),
            prisma.posExpenditure.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { shift: shiftSelect } }),
        ]);

        // Batch-resolve voucher refs + account names (plain-int FKs, no relations).
        const voucherIds = [...receipts, ...expenditures].map((m) => m.voucherId).filter((x): x is number => x != null);
        const accountIds = [...receipts.map((r) => r.accountId), ...expenditures.map((e) => e.expenseAccountId)];
        const [vouchers, accounts] = await Promise.all([
            // Phase 5 5E: receipt/expenditure voucherId points at the spine now.
            prisma.universalVoucher.findMany({ where: { id: { in: voucherIds } }, select: { id: true, reference: true } }),
            prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }),
        ]);
        const refById  = new Map(vouchers.map((v) => [v.id, v.reference]));
        const nameById = new Map(accounts.map((a) => [a.id, a.name]));

        const items = [
            ...receipts.map((r) => ({
                id:        `r-${r.id}`,
                voucherId: r.voucherId ?? null,   // → /receipt/payment/[voucherId] reprint
                kind:      "IN" as const,
                reference: r.voucherId != null ? (refById.get(r.voucherId) ?? "—") : "—",
                date:      r.createdAt.toISOString(),
                amount:    (Number(r.amountPaise) / 100).toFixed(2),
                party:     nameById.get(r.accountId) ?? "—",
                note:      r.note,
                counter:   r.shift.counter.name,
                cashier:   r.shift.user.name,
            })),
            ...expenditures.map((e) => ({
                id:        `e-${e.id}`,
                voucherId: e.voucherId ?? null,   // → /receipt/payment/[voucherId] reprint
                kind:      "OUT" as const,
                reference: e.voucherId != null ? (refById.get(e.voucherId) ?? "—") : "—",
                date:      e.createdAt.toISOString(),
                amount:    (Number(e.amountPaise) / 100).toFixed(2),
                party:     nameById.get(e.expenseAccountId) ?? "—",
                note:      e.description,
                counter:   e.shift.counter.name,
                cashier:   e.shift.user.name,
            })),
        ]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, limit);

        return NextResponse.json({ items });
    } catch (e) {
        return handleApiError(e, "Failed to load cash movements");
    }
}
