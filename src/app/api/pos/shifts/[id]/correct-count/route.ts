// POST /api/pos/shifts/[id]/correct-count
//
// Fix a wrong physical cash count on ANY closed shift — not only the latest on
// its counter, which is all reopen allows. Body: { declaredCashPaise, reason }
//
// No reopen, no OPEN state: an older shift put back to OPEN would collect the
// counter's new sales, and its re-close would read today's till balance. Here
// the books stand (expected is kept) and only what the count decides is redone,
// in one transaction — variance, vault sweep, and their two vouchers rewritten
// in place under the same numbers. The carry-over is locked, so the till still
// ends at what the next shift started from. See shiftCloseCorrection.ts.
//
// Refused for a shift closed by handover (its cash moved into the next shift).
// Runs on the AUTHORITATIVE client: rewriting a posted voucher deletes its old
// lines, which a counter's replica refuses.

import { prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { correctClosedShiftCount, ShiftCountCorrectionError } from "@/modules/pos/lib/shiftCloseCorrection";

const schema = z.object({
    declaredCashPaise: z.number().int().min(0),
    reason:            z.string().trim().min(1, "Reason required").max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_FORCE_CLOSE);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        await prismaAuthoritative.$transaction((tx) => correctClosedShiftCount(tx, {
            shiftId,
            declaredCashPaise: BigInt(data.declaredCashPaise),
            reason:            data.reason,
            userId:            user!.id,
        }), { timeout: 30_000, maxWait: 10_000 });

        await publishChangeServer(["ledger"]);
        return NextResponse.json({ ok: true, id: shiftId });
    } catch (e) {
        if (e instanceof ShiftCountCorrectionError) return NextResponse.json({ error: e.message }, { status: 409 });
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to correct the count");
    }
}
