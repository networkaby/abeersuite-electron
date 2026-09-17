// GET /api/pos/shifts/[id]/expense-accounts
//
// Expense ledgers the cashier may spend to from THIS shift's counter, for the
// POS Exp (expenditure) dialog. The counter's allowedExpenseAccountIds restricts
// the list; an empty array means "no restriction" → every active EXPENSE ledger.
// Always intersected with real, active EXPENSE-group accounts so a stale id in
// the allow-list can never surface a non-expense ledger.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const shift = await prisma.posShift.findUnique({
            where:  { id: shiftId },
            select: { counter: { select: { allowedExpenseAccountIds: true } } },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });

        const allowed = Array.isArray(shift.counter.allowedExpenseAccountIds)
            ? (shift.counter.allowedExpenseAccountIds as unknown[]).filter((x): x is number => typeof x === "number")
            : [];

        const accounts = await prisma.account.findMany({
            where: {
                isActive: true,
                group:    { type: "EXPENSE" },
                ...(allowed.length > 0 ? { id: { in: allowed } } : {}),
            },
            orderBy: [{ name: "asc" }],
            select:  { id: true, name: true, normalBalance: true, group: { select: { id: true, name: true, type: true } } },
        });

        return NextResponse.json(accounts);
    } catch (e) {
        return handleApiError(e, "Failed to load expense accounts");
    }
}
