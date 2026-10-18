/**
 * Per-counter autoincrement id-range reservation.
 *
 * The scheme splits the int4 space (max 2,147,483,647) into non-overlapping zones:
 *
 *   Cloud (Supabase):  1 … 999,999,999
 *   Counter n:         1,000,000,000 + (n-1) × 10,000,000  …  + 10,000,000 - 1
 *
 * With a block size of 10 million ids per counter and 99 counters (the real-world
 * ceiling for counterNumber), the highest reserved id is
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
 * Counter 99's block ends at 1,989,999,999, safely within int4.
 */
export const MAX_COUNTER_NUMBER = 99;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Trims a counter's EPBX extension input and confirms every entry is a whole
 * number. A counter may sit at several extensions, typed as one comma-separated
 * value ("201,202"), so this splits on commas, drops blanks, removes duplicates
 * and joins back with no spaces. A single number behaves exactly as before.
 *
 * No range cap — epbxExtension is the phone extension only. The offline id-range
 * is derived from `counterNumber`, not from this (see blockStartFor below).
 *
 * Returns null if any entry is not a whole number, or nothing is left.
 */
export function normalizeExtensions(input: string): string | null {
    const parts = input
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    if (!parts.length) return null;
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    return [...new Set(parts)].join(",");
}

/**
 * Splits a stored epbxExtension value back into its individual extensions.
 * Tolerates null, spaces and stray commas, so callers need no guard of their own.
 */
export function splitExtensions(stored: string | null | undefined): string[] {
    if (!stored) return [];
    return stored.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
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
 * advance a sequence for those. Inside its own block a sequence never moves backwards;
 * one found above the block (the counter was renumbered lower, so the old lane now
 * belongs to whoever takes that number next) is pulled down into the new block.
 * BLOCK_SIZE above is repeated as a literal inside that function; keep the two in step.
 *
 * A change of counterNumber is what moves a counter between blocks, and the PC only
 * learns of it when it next runs counter setup — so `PATCH /api/pos/counters/[id]`
 * refuses to renumber a counter that is bound to a device unless the same request
 * releases the lock, which sends that PC back through setup.
 */
