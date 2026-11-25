// POST /api/pos/shifts/[id]/expenditures
//
// Mid-shift counter expenditure — a small cash expense paid OUT OF the cashier's
// drawer (tea, sundry donation, etc.). Unlike a cash DROP (log-only — cash stays
// in custody), real money leaves the business here, so we:
//   1. Post a PAYMENT voucher (Dr <expense ledger> / Cr counter till) — lands in
//      the Day Book / Payment register like any other payment.
//   2. Link a PosExpenditure row to the shift (for the close reconciliation).
// Because cash left the drawer, the expected drawer at shift close subtracts the
// shift's expenditures (see shiftMath / the close route).
//
// Funding (the Cr side) is always the shift's counter till — the cashier can
// only spend from their own counter, mirroring the per-counter account routing
// configured at /office/admin/counters.

import { prisma, prismaWhereSaved } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePosVoucher } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { touchPosShift, ShiftNotOpenError } from "@/modules/pos/lib/touchShift";

const expenditureSchema = z.object({
    amountPaise:      z.number().int().positive(),
    description:      z.string().trim().min(1).max(200),
    expenseAccountId: z.number().int().positive(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    // The POS table's Expense Create tick (office-equivalent key also counts) — the
    // same tick the POS screen uses to show this tab. Not the Cash drop chip.
    const { user, response } = await requirePosVoucher("expense", "create");
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, expenditureSchema);
    if (error) return error;

    try {
        const shift = await prismaWhereSaved().posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, userId: true, status: true, branchId: true, counter: { select: { tillAccountId: true, name: true, allowedExpenseAccountIds: true } } },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "OPEN") {
            return NextResponse.json({ error: "Cannot record an expenditure on a closed shift" }, { status: 409 });
        }
        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        // The Dr side must be a real EXPENSE-group ledger.
        const expenseAcc = await prisma.account.findUnique({
            where:  { id: data.expenseAccountId },
            select: { id: true, name: true, isActive: true, group: { select: { type: true } } },
        });
        if (!expenseAcc || !expenseAcc.isActive) {
            return NextResponse.json({ error: "Expense account not found" }, { status: 404 });
        }
        if (expenseAcc.group?.type !== "EXPENSE") {
            return NextResponse.json({ error: `"${expenseAcc.name}" is not an expense account.` }, { status: 422 });
        }
        // Counter-level allow-list — empty means no restriction.
        const allowed = Array.isArray(shift.counter.allowedExpenseAccountIds)
            ? (shift.counter.allowedExpenseAccountIds as unknown[]).filter((x): x is number => typeof x === "number")
            : [];
        if (allowed.length > 0 && !allowed.includes(data.expenseAccountId)) {
            return NextResponse.json(
                { error: `"${expenseAcc.name}" is not allowed at ${shift.counter.name}. Pick an allowed expense ledger.` },
                { status: 422 },
            );
        }

        const tillAccountId = shift.counter.tillAccountId;
        const rupees = data.amountPaise / 100;

        const created = await prisma.$transaction(async (tx) => {
            await touchPosShift(tx, shiftId);

            // PAYMENT voucher (Dr expense / Cr counter till) via the Transaction Engine
            // — created + posted (mirror JE + balance deltas), branch-stamped to the shift.
            const voucher = await engineCreateVoucher(tx, {
                type:      "PAYMENT",
                date:      requestBusinessDate(req),
                userId:    user!.id,
                narration: `POS expenditure — ${data.description}`,
                lines: [
                    { accountId: data.expenseAccountId, type: "DEBIT",  amount: rupees, description: data.description },
                    { accountId: tillAccountId,         type: "CREDIT", amount: rupees, description: `Paid from ${shift.counter.name} drawer` },
                ],
                post:      true,
                branchId:  shift.branchId,
                // Ties the expenditure to the shift on the voucher itself — the
                // shift report and the drawer tally read it from there. The old
                // pos_expenditures side row held a copy of these same figures and
                // outlived the voucher whenever one was deleted.
                shiftId,
            });
            return { voucherId: voucher.id, voucherRef: voucher.reference };
        });

        return NextResponse.json(
            { id: created.voucherId, voucherId: created.voucherId, voucherRef: created.voucherRef, amountPaise: String(data.amountPaise) },
            { status: 201 },
        );
    } catch (e) {
        if (e instanceof ShiftNotOpenError) return NextResponse.json({ error: "Cannot record an expenditure on a closed shift" }, { status: 409 });
        return handleApiError(e, "Failed to record expenditure");
    }
}
