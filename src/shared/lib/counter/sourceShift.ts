/**
 * Which POS shift a row was raised ON — the value behind `sourceShiftId` on
 * UniversalVoucher, the finer twin of `sourceCounterId` (see sourceCounter.ts).
 *
 * ── Why the voucher carries the shift ───────────────────────────────────────
 * A counter document belongs to a shift, and a shift belongs to a counter. That
 * is one fact, so it lives in one column on the voucher itself. Before this, the
 * link lived OUTSIDE the voucher in `pos_receipts` / `pos_expenditures` — side
 * rows holding a copy of the amount, account, note and creator whose only real
 * content was the shift id. Two consequences, both now gone:
 *
 *   • deleting a voucher left its POS row behind, still listed on the counter's
 *     Payment/Receipt tab with a dash where the reference should be;
 *   • POS SALES had no link at all, so shift close attributed them by a
 *     `createdAt` time window and stayed correct only because the GL filter
 *     happened to be restricted to that counter's own ledgers.
 *
 * ── Resolution ──────────────────────────────────────────────────────────────
 * The caller's explicit shift always wins: the POS routes are handed a shift id
 * in the URL and have already checked it is open and theirs, so no inference can
 * beat it. Otherwise the counter answers — the shift standing at that counter
 * right now. No counter (the office) means no shift, and that is a real answer,
 * not a failure.
 *
 * Never throws: provenance must not be able to fail a sale.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";

/** Either the global client or an open transaction's — see sourceCounter.ts. */
type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * The shift standing at `counterId` right now, or null.
 *
 * AWAITING_HANDOVER counts as standing: cashier A has handed over but B has not
 * accepted yet, and anything billed in that gap still belongs to A's shift —
 * which is exactly the shift whose drawer the money is in.
 *
 * Not cached. Counters are near-static and cached for that reason; a shift opens
 * and closes through the day, and a stale answer here would file a voucher under
 * a shift that has already been counted and closed. One indexed lookup
 * (`@@index([counterId, status])`) on a table of open shifts is the cheaper
 * mistake. Office writes (`counterId == null`) skip it entirely, so the whole
 * back office pays nothing for this.
 */
export async function shiftIdForCounter(
    db: DbClient,
    counterId: number | null,
): Promise<number | null> {
    if (counterId == null) return null;
    try {
        const shift = await db.posShift.findFirst({
            where:   { counterId, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            orderBy: { openedAt: "desc" },
            select:  { id: true },
        });
        return shift?.id ?? null;
    } catch {
        // A shift we could not read is "unattributed", never a failed voucher.
        return null;
    }
}
