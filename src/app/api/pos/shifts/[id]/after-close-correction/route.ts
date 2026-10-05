// POST /api/pos/shifts/[id]/after-close-correction
//
// A voucher of a CLOSED shift changed after the close — a POS sale edited from
// UPI to cash, an expense corrected — so the till's books no longer match the
// cash that was counted. Reopen + re-close fixes it only while this is the
// counter's latest shift; this posts the correcting Journal instead, any time.
//
// The difference is worked out here, never taken from the browser: what the
// shift's vouchers have moved the till since the close, net of corrections
// already posted (shiftCashChangedAfterClose, via buildShiftSummary).
//
//   more cash in the books than was counted (D > 0):
//       Dr Cash Over (the close recorded "over") or Cash Short   Cr Till
//   less (D < 0):
//       Dr Till   Cr Cash Short (the close recorded "short") or Cash Over
//
// Dated on the close day and carrying the shift, so the till's day-by-day
// balance comes right and the shift report counts it as done.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { enginePost } from "@/modules/accountancy/lib/transactionEngine";
import { buildShiftSummary } from "@/modules/pos/lib/shiftSummary";
import { startOfDayUtc, businessTodayIso } from "@/shared/lib/format/formatDate";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);
    if (response) return response;

    const shiftId = Number((await params).id);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const shift = await prisma.posShift.findUnique({
            where:   { id: shiftId },
            include: {
                branch:  { select: { id: true } },
                counter: { include: { tillAccount: { select: { id: true } }, paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } } } },
                drops:   { select: { amountPaise: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "CLOSED" || shift.expectedCashPaise == null || shift.closedAt == null) {
            return NextResponse.json({ error: "Only a closed shift takes an after-close correction." }, { status: 409 });
        }

        const { changedAfterClosePaise } = await buildShiftSummary(prisma, shift);
        const diff = Number(changedAfterClosePaise ?? 0);
        if (diff === 0) return NextResponse.json({ error: "Nothing to correct — the shift's cash matches its close." }, { status: 409 });

        const [shortAcc, overAcc] = await Promise.all([
            prisma.account.findFirst({ where: { name: "Cash Short" }, select: { id: true } }),
            prisma.account.findFirst({ where: { name: "Cash Over" },  select: { id: true } }),
        ]);
        if (!shortAcc || !overAcc) {
            return NextResponse.json({ error: "Cash Short / Cash Over ledgers missing. Re-run bootstrap seed." }, { status: 500 });
        }

        // Undo the side the close booked; with no variance at close, the change is
        // a shortfall (D > 0) or a surplus (D < 0) of its own.
        const closeVariance = Number(shift.variancePaise ?? 0);
        const rupees = Math.abs(diff) / 100;
        const tillId = shift.counter.tillAccountId;
        const glLines = diff > 0
            ? [
                { accountId: closeVariance > 0 ? overAcc.id : shortAcc.id, type: "DEBIT" as const, amount: rupees, description: "Correction — cash changed after close" },
                { accountId: tillId, type: "CREDIT" as const, amount: rupees, description: "Correction — cash changed after close" },
            ]
            : [
                { accountId: tillId, type: "DEBIT" as const, amount: rupees, description: "Correction — cash changed after close" },
                { accountId: closeVariance < 0 ? shortAcc.id : overAcc.id, type: "CREDIT" as const, amount: rupees, description: "Correction — cash changed after close" },
            ];

        const closedAt = shift.closedAt;
        const posted = await prisma.$transaction(async (tx) => {
            const p = await enginePost(tx, {
                type:        "JOURNAL",
                date:        startOfDayUtc(businessTodayIso(closedAt)),
                description: `Shift #${shift.id} — correction for vouchers changed after close (${diff > 0 ? "+" : "−"}₹${rupees.toFixed(2)})`,
                glLines,
                stockMoves:  [],
            }, user!.id, { branchId: shift.branch.id });
            if (p.universalVoucherId == null) throw new Error("The correcting Journal did not post.");
            // Carried on the shift, so its report counts the correction as done.
            await tx.universalVoucher.update({ where: { id: p.universalVoucherId }, data: { sourceShiftId: shift.id } });
            return p;
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, voucherId: posted.universalVoucherId });
    } catch (e) {
        return handleApiError(e, "Failed to post the correction");
    }
}
