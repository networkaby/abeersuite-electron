// POST /api/pos/shifts/[id]/delete
//
// Remove a shift that carries nothing: no receipts, drops, expenditures or
// handover. Body: { reason }
//
// A shift with sales cannot go — its receipts and cash-sales window would be
// orphaned; reopen it and close it correctly instead.
//
// One transaction on the AUTHORITATIVE client: cancel the opening Contra
// (vault top-up), the closing Contra and the variance Journal if present —
// reversing their balances — then delete the row (drops/expenditures/receipts
// cascade, but the guard above means there are none).

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
            select: {
                id: true, status: true, counterId: true, closedAt: true, handoverToShiftId: true,
                openingContraVoucherId: true, closingContraVoucherId: true, varianceJournalEntryId: true,
                handover: { select: { id: true } },
                receivedHandover: { select: { id: true } },
                _count: { select: { drops: true, expenditures: true, receipts: true } },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status === "AWAITING_HANDOVER") {
            return NextResponse.json({ error: "Shift is awaiting handover. Cancel the handover first." }, { status: 409 });
        }
        const attached = [
            shift._count.receipts     > 0 ? `${shift._count.receipts} receipt(s)`         : null,
            shift._count.drops        > 0 ? `${shift._count.drops} cash drop(s)`          : null,
            shift._count.expenditures > 0 ? `${shift._count.expenditures} expenditure(s)` : null,
        ].filter((x): x is string => x !== null);
        if (attached.length > 0) {
            return NextResponse.json(
                { error: `This shift has ${attached.join(", ")} on it and cannot be deleted. Reopen it and close it again with the correct figures.` },
                { status: 409 },
            );
        }
        if (shift.handover || shift.receivedHandover) {
            return NextResponse.json({ error: "This shift is part of a cashier handover and cannot be deleted." }, { status: 409 });
        }
        const block = await shiftManageBlock(db, shift);
        if (block) return NextResponse.json({ error: block }, { status: 409 });

        const reason = `Shift #${shift.id} deleted: ${data.reason}`;
        await db.$transaction(async (tx) => {
            for (const vid of [shift.openingContraVoucherId, shift.closingContraVoucherId, shift.varianceJournalEntryId]) {
                if (vid != null) await cancelVoucherInTx(tx, vid, user!.id, reason);
            }
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
