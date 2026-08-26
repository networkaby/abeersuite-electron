/**
 * Per-counter autoincrement id-range reservation.
 *
 * The scheme splits the int4 space (max 2,147,483,647) into non-overlapping zones:
 *
 *   Cloud (Supabase):  1 … 999,999,999
 *   Counter n:         1,000,000,000 + (n-1) × 10,000,000  …  + 10,000,000 - 1
 *
 * With a block size of 10 million ids per counter and 114 counters, the highest
 * reserved id is 2,139,999,999 — safely within int4.
 *
 * Only tables whose Prisma model carries `@default(autoincrement())` need a
 * sequence reservation; every other table uses a UUID or an application-assigned
 * key and is unaffected.
 */

// ── Range constants ──────────────────────────────────────────────────────────

/** The first id that belongs to the counter range (cloud gets 1 … CLOUD_RANGE_END - 1). */
export const CLOUD_RANGE_END = 1_000_000_000;

/** Number of ids reserved per counter per sequence. */
export const BLOCK_SIZE = 10_000_000;

/**
 * Maximum counter number supported by this scheme.
 * Counter 114's block ends at 2,139,999,999 — the highest value that fits int4.
 */
export const MAX_COUNTER_NUMBER = 114;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the first id in counter `counterNumber`'s reserved block.
 *
 * @param counterNumber  1-based counter number (1 … 114)
 * @throws {RangeError}  if `counterNumber` is outside 1 … MAX_COUNTER_NUMBER
 */
export function blockStartFor(counterNumber: number): number {
    if (
        !Number.isInteger(counterNumber) ||
        counterNumber < 1 ||
        counterNumber > MAX_COUNTER_NUMBER
    ) {
        throw new RangeError(
            `counterNumber must be an integer between 1 and ${MAX_COUNTER_NUMBER}, got ${counterNumber}`,
        );
    }
    return CLOUD_RANGE_END + (counterNumber - 1) * BLOCK_SIZE;
}

/**
 * Returns the last id in counter `counterNumber`'s reserved block (inclusive).
 *
 * @param counterNumber  1-based counter number (1 … 114)
 * @throws {RangeError}  if `counterNumber` is outside 1 … MAX_COUNTER_NUMBER
 */
export function blockEndFor(counterNumber: number): number {
    return blockStartFor(counterNumber) + BLOCK_SIZE - 1;
}

// ── Sequence catalogue ───────────────────────────────────────────────────────

/**
 * The 7 PostgreSQL sequences that need their start value overridden on the
 * local replica. These are the only tables whose Prisma model uses
 * `@default(autoincrement())`.
 */
export const OFFLINE_SEQUENCES: readonly string[] = [
    "universal_vouchers_id_seq",
    "voucher_details_id_seq",
    "voucher_gl_lines_id_seq",
    "voucher_inventory_lines_id_seq",
    "voucher_links_id_seq",
    "tickets_id_seq",
    "ticket_logs_id_seq",
] as const;

/**
 * Maps a Prisma model name to its PostgreSQL sequence name.
 * Only models with `@default(autoincrement())` are listed.
 */
export const OFFLINE_SEQUENCE_MAP: Record<string, string> = {
    UniversalVoucher: "universal_vouchers_id_seq",
    VoucherDetail: "voucher_details_id_seq",
    VoucherGlLine: "voucher_gl_lines_id_seq",
    VoucherInventoryLine: "voucher_inventory_lines_id_seq",
    VoucherLink: "voucher_links_id_seq",
    Ticket: "tickets_id_seq",
    TicketLog: "ticket_logs_id_seq",
};
