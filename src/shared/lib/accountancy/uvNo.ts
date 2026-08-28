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
 * using: YY (2 digits FY) + CC (2 digits Counter) + NNNNN (5 digits sequence).
 *
 * Example: FY 2026, Counter 1, Seq 45 -> 260100045
 * Fits comfortably in a standard PostgreSQL Int4 (max 2,147,483,647).
 */
export function generateNumericUvId(fyYear: number, counterNumber: number, localSeq: number): number {
    const yy = fyYear % 100;
    const cc = Math.min(Math.max(counterNumber, 1), 99);
    const seq = Math.min(Math.max(localSeq, 1), 99999);
    return yy * 10_000_000 + cc * 100_000 + seq;
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
