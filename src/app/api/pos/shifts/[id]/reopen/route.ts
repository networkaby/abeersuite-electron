// POST /api/pos/shifts/[id]/reopen
//
// Undo a wrong close so the shift can be closed again with corrected figures.
// Body: { reason }
//
// One transaction, on the AUTHORITATIVE client (a counter's replica push drops
// any pos_shifts write against a shift the DB says is CLOSED — see push.ts):
//   1. Cancel the closing Contra (till → vault sweep) and the variance Journal,
//      reversing their ledger balances exactly as the voucher cancel route does.
//      One already cancelled by hand is left as it is — that is the state we want.
//   2. Clear every closing figure and put the shift back to OPEN.
// The manager then re-closes through the ordinary close route.
//
// Refused when a later shift already ran on this counter — it started from
// this one's carry-over, so the till would be rewritten under it — and when
// the shift was closed by handover (its cash moved into the next shift).

import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { cancelVoucherInTx } from "@/modules/accountancy/lib/cancelVoucherInTx";
import { lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { shiftManageBlock } from "@/modules/pos/lib/shiftManage";

const schema = z.object({ reason: z.string().trim().min(1, "Reason required").max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const db = prismaAuthoritative;
        const shift = await db.posShift.findUnique({
            where:  { id: shiftId },
            select: { id: true, status: true, counterId: true, closedAt: true, handoverToShiftId: true, closingContraVoucherId: true, varianceJournalEntryId: true, notes: true },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "CLOSED") return NextResponse.json({ error: "Only a closed shift can be reopened" }, { status: 409 });

        const block = await shiftManageBlock(db, shift);
        if (block) return NextResponse.json({ error: block }, { status: 409 });

        const reason = `Shift #${shift.id} reopened: ${data.reason}`;
        await db.$transaction(async (tx) => {
            if (shift.closingContraVoucherId != null) await cancelVoucherInTx(tx, shift.closingContraVoucherId, user!.id, reason, { skipIfCancelled: true });
            if (shift.varianceJournalEntryId != null) await cancelVoucherInTx(tx, shift.varianceJournalEntryId, user!.id, reason, { skipIfCancelled: true });
            await tx.posShift.update({
                where: { id: shift.id },
                data: {
                    status:                 "OPEN",
                    closedAt:               null,
                    closedById:             null,
                    declaredCashPaise:      null,
                    expectedCashPaise:      null,
                    variancePaise:          null,
                    carryOverNextPaise:     null,
                    toVaultPaise:           null,
                    closingContraVoucherId: null,
                    varianceJournalEntryId: null,
                    notes: shift.notes ? `${shift.notes}\nReopened: ${data.reason}` : `Reopened: ${data.reason}`,
                },
            });
        }, { timeout: 30_000, maxWait: 10_000 });

        await publishChangeServer(["ledger"]);
        return NextResponse.json({ ok: true, id: shift.id, status: "OPEN" });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to reopen shift");
    }
}
