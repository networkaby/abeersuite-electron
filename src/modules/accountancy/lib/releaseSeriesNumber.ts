// Give a voucher number back to its series.
//
// Numbering only ever moves forward: `nextRefFromSeries` post-increments the
// (kind, counter) row and nothing walks it back, so a deleted voucher normally
// leaves a permanent hole in the book. That is the right default while the
// voucher is merely hard-deleted — its snapshot is sitting in the Recycle Bin and
// `auditRestore` puts it back under its ORIGINAL number, which must therefore
// stay reserved.
//
// The one moment the number is genuinely free is when that snapshot is destroyed
// (DELETE /api/audit/[id]): nothing can claim the number back any more. If the
// purged voucher happened to hold the TIP of its series, the next fresh voucher
// should carry on from there instead of skipping a number. That is what this does.
//
// "Was it the tip?" is answered by construction, not by parsing: rebuild the
// reference each counter row WOULD print at its current `nextSeq` using the very
// same `assembleReference` the allocator uses, and look for an exact string match.
// A middle-of-the-run voucher matches nothing and the series is left untouched, so
// the book never renumbers itself behind anyone's back.
//
// Every counter is in scope, not just the office's row — the owner's call on
// 2026-09-20. The usual ownership rule (only the machine that numbers a row writes
// it) is knowingly relaxed here: if a till was offline with queued bills while the
// office released its tip, the office's rollback can land on top of the till's row
// and one bill number can be issued twice. Accepted deliberately; a purge is a rare,
// super-admin-only act.

import type { InvVoucherType, Prisma } from "@/generated/prisma/client";
import { SERIES_KINDS } from "@/modules/inventory/lib/stock";
import { assembleReference } from "./voucherRef";

type Tx = Prisma.TransactionClient;

// The VoucherSeries a purged snapshot's number came out of, or null when that kind
// is not series-numbered. Inventory kinds route through the SAME map the allocator
// uses (`invNextRef`), so the legacy prefix kinds — POS_ESTIMATE, POS_ORDER and
// friends, which count their own surviving rows and therefore re-use a freed number
// by themselves — are excluded by construction. A GL voucher type IS its series kind.
export function seriesKindOf(entityType: string, subtype: string | null): string | null {
    // Legacy JOURNAL_ENTRY rows carry no subtype — the entity type WAS the kind back
    // then, and every one of them is a journal voucher.
    if (!subtype) return entityType === "JOURNAL_ENTRY" ? "JOURNAL" : null;
    if (entityType === "INV_VOUCHER") return SERIES_KINDS[subtype as InvVoucherType] ?? null;
    return subtype;
}

/**
 * Hand `reference` back to series `seriesKind` when it is the last number issued.
 * Returns the released reference, or `null` when nothing was released (unknown
 * series, number sits mid-run, or the number is still in use by a live voucher).
 */
export async function releaseSeriesNumber(
    tx: Tx,
    seriesKind: string | null | undefined,
    reference: string | null | undefined,
): Promise<string | null> {
    if (!seriesKind || !reference) return null;

    const series = await tx.voucherSeries.findUnique({ where: { kind: seriesKind } });
    if (!series) return null;

    // A number still printed on a living voucher is not free, whatever the counter
    // says. This is what stops an EDIT snapshot from releasing a number: an in-place
    // edit writes its pre-edit copy to the Recycle Bin while the voucher carries on
    // living under the very same reference.
    const stillInUse = await tx.universalVoucher.count({ where: { voucherNo: reference } });
    if (stillInUse > 0) return null;

    // Another snapshot of the SAME reference can still be restored, and restore puts
    // the voucher back under its original number. One reference commonly has several
    // rows in the bin — every in-place edit leaves one, and the final delete leaves
    // one more — so purging any single row is not the end of that number's life.
    // Release only when the row just destroyed was the LAST copy of it.
    const otherCopies = await tx.auditLog.count({ where: { originalRef: reference } });
    if (otherCopies > 0) return null;

    const rows = await tx.voucherSeriesCounter.findMany({ where: { kind: seriesKind } });

    for (const row of rows) {
        if (row.nextSeq < 1) continue;
        const fyStartYear = row.fyStartYear ?? series.fyStartYear;
        const tip = assembleReference({ ...series, nextSeq: row.nextSeq, fyStartYear }, row.counterNumber);
        if (tip !== reference) continue;

        // This row's tip IS the purged voucher — step it back one so the next
        // voucher on that counter re-issues the number.
        const key = { kind_counterNumber: { kind: seriesKind, counterNumber: row.counterNumber } };
        await tx.voucherSeriesCounter.update({ where: key, data: { nextSeq: row.nextSeq - 1 } });
        return reference;
    }

    return null;
}
