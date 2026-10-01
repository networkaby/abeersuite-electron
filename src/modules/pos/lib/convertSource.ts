import type { Prisma } from "@/generated/prisma/client";

// ── Convert guard ────────────────────────────────────────────────────────────
// A converted voucher points back at its source through refVoucherId. A source
// counts as "converted" while any LIVE (not cancelled) voucher points at it —
// cancelling / deleting the conversion opens it again. One reader for every
// convert path: the Daybook ⋮ convert, the till's ⇄ mode switch (POS sale /
// order), so "already converted" means the same thing everywhere.

/** Thrown by a creator when its convert source is refused — the route answers 409. */
export class ConvertSourceError extends Error {}

type Db =Pick<Prisma.TransactionClient, "voucherDetail">;

/** The live voucher this source was converted into, or null. */
export async function findLiveConversion(db: Db, sourceId: number): Promise<{ id: number; ref: string } | null> {
    const hit = await db.voucherDetail.findFirst({
        where:  { refVoucherId: sourceId, universalVoucher: { status: { not: "CANCELLED" } } },
        select: { id: true, universalVoucher: { select: { voucherNo: true } } },
    });
    return hit ? { id: hit.id, ref: hit.universalVoucher?.voucherNo ?? `#${hit.id}` } : null;
}

/**
 * Check a convert source before a voucher is created from it. Returns the
 * message to refuse with, or null when the source may be converted.
 * `allowedTypes` limits which voucher types may be the source (omit = any).
 */
export async function convertSourceError(db: Db, sourceId: number, allowedTypes?: readonly string[]): Promise<string | null> {
    if (allowedTypes) {
        const src = await db.voucherDetail.findUnique({
            where:  { id: sourceId },
            select: { universalVoucher: { select: { type: true } } },
        });
        const type = src?.universalVoucher?.type;
        if (!type) return "The voucher to convert was not found.";
        if (!allowedTypes.includes(type)) return `Cannot convert ${type} here.`;
    }
    const done = await findLiveConversion(db, sourceId);
    return done ? `Already converted to ${done.ref}. Delete that voucher to convert this again.` : null;
}
