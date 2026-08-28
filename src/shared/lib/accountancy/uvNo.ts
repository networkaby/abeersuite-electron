// Universal Voucher No (UVNo) — the UniversalVoucher spine already has a unique
// `id`, so the id IS the universal identifier. There is no separate number column;
// this helper just renders the display LABEL (`UV-<id>`). See docs/vocabulary.md
// ("Voucher No · Universal Voucher No"). Distinct from the per-kind Voucher No
// (`UniversalVoucher.voucherNo`, e.g. SV-/PMT-/POS-).

export function formatUvNo(id: number | null | undefined): string {
    return id != null ? `UV-${id}` : "";
}

/**
 * Generate a collision-free 9-digit numeric Primary Key for UniversalVoucher
 * using: YY (2 digits FY) + Counter (2 digits) + Sequence (5 digits). Mirrors
 * shared/lib/id/numericId.ts — see that file for why `counterNumber` alone is
 * safe (assigned globally unique across branches at counter-creation time) and
 * why there is no fallback for a missing counter.
 *
 * Example: FY 2026, Counter 1, Seq 45 -> 260100045
 * Fits comfortably in a standard PostgreSQL Int4 (max 2,147,483,647).
 */
const MAX_COUNTER = 99;
const MAX_SEQ     = 99999;

export function generateNumericUvId(fyYear: number, counterNumber: number, localSeq: number): number {
    if (!Number.isInteger(counterNumber) || counterNumber < 1 || counterNumber > MAX_COUNTER) {
        throw new Error(`generateNumericUvId: counterNumber must be 1-${MAX_COUNTER}, got ${counterNumber}`);
    }
    if (!Number.isInteger(localSeq) || localSeq < 1 || localSeq > MAX_SEQ) {
        throw new Error(`generateNumericUvId: localSeq must be 1-${MAX_SEQ}, got ${localSeq}`);
    }
    const yy = fyYear % 100;
    return yy * 10_000_000 + counterNumber * 100_000 + localSeq;
}

/**
 * Deconstruct a 9-digit numeric UniversalVoucher ID back into its components.
 */
export function parseNumericUvId(id: number): { fyYear: number; counterNumber: number; seq: number } | null {
    if (!Number.isInteger(id) || id < 100000000 || id > 999999999) {
        return null;
    }
    const yy = Math.floor(id / 10_000_000);
    const cc = Math.floor((id % 10_000_000) / 100_000);
    const seq = id % 100_000;
    return { fyYear: 2000 + yy, counterNumber: cc, seq };
}
