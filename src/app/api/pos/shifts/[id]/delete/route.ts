// POST /api/pos/shifts/[id]/delete
//
// Remove a shift that carries nothing: no live voucher and no drop (the rule
// and its reasons live in `shiftDeleteBlockers`). Body: { reason }
//
// A shift with vouchers cannot go — delete the vouchers first, then the shift.
// Any shift on the counter qualifies, not only the latest, and till movement
// does not matter.
//
// One transaction on the AUTHORITATIVE client: cancel the opening Contra
// (vault top-up), the closing Contra and the variance Journal if present —
// reversing their balances — remove the cashier handover this shift gave or
// received, so the shift on the other side of it simply stops pointing here,
// then delete the row (drops cascade, but the guard above means there are none).
//
// A shift that was reopened carries its closing vouchers as parked DRAFTs
// (see parkVoucherInTx.ts). Those never posted, so they are discarded outright
// rather than cancelled — there is nothing to reverse and nothing to keep.

import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { cancelVoucherInTx } from "@/modules/accountancy/lib/cancelVoucherInTx";
import { discardParkedDraftInTx } from "@/modules/accountancy/lib/parkVoucherInTx";
import { lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { shiftDeleteBlockers } from "@/modules/pos/lib/shiftManage";

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
            select: {
                id: true,
                openingContraVoucherId: true, closingContraVoucherId: true, varianceJournalEntryId: true,
                _count: { select: { drops: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        const blockers = await shiftDeleteBlockers(db, { ...shift, dropCount: shift._count.drops });
        if (blockers.length > 0) {
            return NextResponse.json(
                { error: `Shift #${shift.id} cannot be deleted: ${blockers.join("; ")}.` },
                { status: 409 },
            );
        }

        const reason = `Shift #${shift.id} deleted: ${data.reason}`;
        await db.$transaction(async (tx) => {
            for (const vid of [shift.openingContraVoucherId, shift.closingContraVoucherId, shift.varianceJournalEntryId]) {
                if (vid == null) continue;
                // A parked DRAFT goes for good; anything POSTED is cancelled as before.
                if (await discardParkedDraftInTx(tx, vid)) continue;
                await cancelVoucherInTx(tx, vid, user!.id, reason, { skipIfCancelled: true });
            }
            // The handover goes with the shift, whichever side of it this was.
            await tx.posHandover.deleteMany({ where: { OR: [{ fromShiftId: shift.id }, { toShiftId: shift.id }] } });
            await tx.posShift.updateMany({ where: { handoverToShiftId: shift.id }, data: { handoverToShiftId: null } });
            await tx.posShift.delete({ where: { id: shift.id } });
        }, { timeout: 30_000, maxWait: 10_000 });

        await publishChangeServer(["ledger"]);
        return NextResponse.json({ ok: true, id: shift.id });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to delete shift");
    }
}
