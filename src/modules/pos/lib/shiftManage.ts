// Shared guards for the shift reopen / delete routes.

import type { PrismaClient } from "@/generated/prisma/client";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";

// ── Reopen ────────────────────────────────────────────────────────────────────
//
// A closed shift's sweep and carry-over are what the NEXT shift on the same
// counter started from. Voiding those vouchers once a later shift exists would
// rewrite the till under that shift, so reopen refuses. Likewise a shift that
// ended by handover has its cash living on in the receiving shift.

export async function shiftManageBlock(
    db: PrismaClient,
    shift: { id: number; counterId: number; closedAt: Date | null; handoverToShiftId: number | null },
): Promise<string | null> {
    if (shift.handoverToShiftId != null) {
        return `This shift was handed over to shift #${shift.handoverToShiftId} and cannot be changed.`;
    }
    const later = await db.posShift.findFirst({
        where:   { counterId: shift.counterId, id: { gt: shift.id } },
        orderBy: { id: "asc" },
        select:  { id: true, status: true },
    });
    if (later) {
        return `Shift #${later.id} has already run on this counter after this one. Only the latest shift on a counter can be reopened.`;
    }
    return null;
}

// ── Delete ────────────────────────────────────────────────────────────────────
//
// A shift can be deleted when nothing is on it: no live voucher raised on it
// (sale, receipt, expenditure, return, order …) and no cash drop. Delete the
// vouchers first, then the shift.
//
// Part of the delete, not a reason to refuse it: the shift's OWN vouchers — the
// opening top-up, the closing sweep and the variance journal — which the delete
// cancels, and the cashier handover the shift gave or received, which the
// delete removes (the other shift simply stops pointing at this one).
//
// Deliberately NOT a reason either: till movement, and a later shift on the
// counter. The till balance moves whenever any older voucher on that cash
// account is deleted, which says nothing about this shift. Cancelling an older
// shift's sweep does shift the later shifts' till figures; the owner accepts that.
//
// One reader for the delete route and the detail page, so the button can never
// hide for a reason the server would not give.

type DeleteGuardShift = {
    id: number;
    openingContraVoucherId: number | null;
    closingContraVoucherId: number | null;
    varianceJournalEntryId: number | null;
    dropCount: number;
};

const LISTED_VOUCHERS = 5;

export async function shiftDeleteBlockers(db: PrismaClient, shift: DeleteGuardShift): Promise<string[]> {
    const own = [shift.openingContraVoucherId, shift.closingContraVoucherId, shift.varianceJournalEntryId]
        .filter((x): x is number => x != null);
    const where = {
        sourceShiftId: shift.id,
        deletedAt:     null,
        status:        { not: "CANCELLED" as const },
        ...(own.length > 0 ? { id: { notIn: own } } : {}),
    };
    const [count, sample] = await Promise.all([
        db.universalVoucher.count({ where }),
        db.universalVoucher.findMany({
            where,
            orderBy: { id: "asc" },
            take:    LISTED_VOUCHERS,
            select:  { id: true, voucherNo: true },
        }),
    ]);

    const out: string[] = [];
    if (count > 0) {
        const refs = sample.map((v) => v.voucherNo ?? formatUvNo(v.id)).join(", ");
        const more = count > sample.length ? ` and ${count - sample.length} more` : "";
        out.push(`${count} voucher(s) on it (${refs}${more})`);
    }
    if (shift.dropCount > 0) out.push(`${shift.dropCount} cash drop(s)`);
    return out;
}
