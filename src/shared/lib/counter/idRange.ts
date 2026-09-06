/**
 * Per-counter autoincrement id-range reservation.
 *
 * The scheme splits the int4 space (max 2,147,483,647) into non-overlapping zones:
 *
 *   Cloud (Supabase):  1 … 999,999,999
 *   Counter n:         1,000,000,000 + (n-1) × 10,000,000  …  + 10,000,000 - 1
 *
 * With a block size of 10 million ids per counter and 99 counters (the real-world
 * ceiling — EPBX extensions here are 2 digits), the highest reserved id is
 * 1,989,999,999 — safely within int4.
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
 * Matches the real-world ceiling — EPBX extensions here are 2 digits (1–99).
 * Counter 99's block ends at 1,989,999,999, safely within int4.
 */
export const MAX_COUNTER_NUMBER = 99;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Trims a counter's EPBX extension input and confirms it's a whole number —
 * no padding, no range cap (epbxExtension itself has no ceiling; only the
 * offline id-range derived from it in claim-number/route.ts is capped at
 * MAX_COUNTER_NUMBER). Returns null if it isn't a whole number.
 */
export function normalizeExtension(input: string): string | null {
    const trimmed = input.trim();
    return /^\d+$/.test(trimmed) ? trimmed : null;
}

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
 * There is deliberately no hand-written list of sequences here any more.
 *
 * There used to be one, naming 11. The schema has 79 models on
 * `@default(autoincrement())`, and once the counter writes locally by default it
 * writes all of them — so 68 sequences would have kept minting ids from 1, colliding
 * head-on with cloud ids. That failure is silent rather than loud: the push upserts by
 * id, so a colliding row overwrites an unrelated cloud record.
 *
 * `_apply_id_range()` (defined in `resources/local-schema.sql`, called by
 * `electron/applyIdRanges.ts`, `electron/localDbProvisioner.ts` at boot, and
 * `sync-engine/sync-once.js` after every pull) reads the sequences out of the
 * PostgreSQL catalogue instead, so a table added tomorrow is covered with nothing to
 * remember. It also steps each sequence past any id already present inside this
 * counter's block, because the pull inserts rows with their ids and Postgres does not
 * advance a sequence for those. BLOCK_SIZE above is repeated as a literal inside that
 * function; keep the two in step.
 */
