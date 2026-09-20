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

import type { Prisma } from "@/generated/prisma/client";
import { assembleReference } from "./voucherRef";

type Tx = Prisma.TransactionClient;

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
    // says. Cheap insurance against releasing into a collision.
    const stillInUse = await tx.universalVoucher.count({ where: { voucherNo: reference } });
    if (stillInUse > 0) return null;

    const rows = await tx.voucherSeriesCounter.findMany({ where: { kind: seriesKind } });

    // Counter 1 predates the per-counter table: if the office has no row of its own
    // yet, its running number is still the legacy `VoucherSeries.nextSeq`, which is
    // exactly what the allocator would seed that row from.
    const candidates = rows.some((r) => r.counterNumber === 1)
        ? rows
        : [...rows, { kind: seriesKind, counterNumber: 1, nextSeq: series.nextSeq, fyStartYear: series.fyStartYear }];

    for (const row of candidates) {
        if (row.nextSeq < 1) continue;
        const fyStartYear = row.fyStartYear ?? series.fyStartYear;
        const tip = assembleReference({ ...series, nextSeq: row.nextSeq, fyStartYear }, row.counterNumber);
        if (tip !== reference) continue;

        // This row's tip IS the purged voucher — step it back one so the next
        // voucher on that counter re-issues the number.
        const key = { kind_counterNumber: { kind: seriesKind, counterNumber: row.counterNumber } };
        const rolled = await tx.voucherSeriesCounter.upsert({
            where:  key,
            create: { kind: seriesKind, counterNumber: row.counterNumber, nextSeq: row.nextSeq - 1, fyStartYear, resetGen: series.resetGen },
            update: { nextSeq: row.nextSeq - 1 },
        });

        // Same mirror the allocator keeps: the Year Ending page still reads the
        // legacy column for counter 1, so it must not drift behind the real row.
        if (row.counterNumber === 1) {
            await tx.voucherSeries.update({
                where: { kind: seriesKind },
                data:  { nextSeq: rolled.nextSeq, fyStartYear: rolled.fyStartYear },
            });
        }
        return reference;
    }

    return null;
}
