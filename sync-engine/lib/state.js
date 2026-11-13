"use strict";

/**
 * `_sync_state` - one row per replicated table, recording how far this replica has
 * caught up. Lives ONLY in the local database; Supabase never sees it.
 *
 * Keyed on the registry's stable table NUMBER, not the name. A rename then costs a
 * name update instead of silently resetting that table's watermark to the beginning
 * of time (or, worse, leaving a stale row that no table claims).
 */

const { q } = require("./db");
const { ensureTable } = require("./bookkeeping");

const TABLE = "_sync_state";

/** One list for create AND upgrade — see bookkeeping.js. */
const COLUMNS = [
    ["table_num", "integer PRIMARY KEY"],
    ["model", "text NOT NULL"],
    ["table_name", "text NOT NULL"],
    ["strategy", "text NOT NULL"],
    // High-water mark for watermark/append tables: the largest source timestamp
    // known to have been pulled. NULL means "never synced".
    ["watermark", "timestamptz"],
    // Tie-breaker for that timestamp. Timestamps are NOT unique: a bulk import can
    // stamp thousands of rows identically (Person has 3529 rows sharing one value).
    // With a timestamp-only cursor, a page that ends inside such a block advances the
    // watermark past it and the remainder becomes permanently invisible - no error,
    // no retry, just rows that never arrive. Pagination is therefore keyed on
    // (watermark, watermark_id), which is a total order.
    ["watermark_id", "text"],
    // WHICH source column the watermark above was read from. A stored high-water mark
    // only means something against the column it was taken from, and that column can
    // change underneath it: when a model gains @updatedAt the generator re-files the
    // table from append/createdAt to watermark/updatedAt, and the old createdAt value
    // is then read as an updatedAt cursor. Nothing about that is an error - it
    // silently skips rows or silently re-reads them, with no log either way. Call is
    // the worked example (2026-09-13): notes staff had already saved sat in Supabase
    // and never reached a counter. NULL on a row written by an engine older than this
    // column; see cursorFor for why that is not treated as a change.
    ["cursor_column", "text"],
    ["row_count", "bigint"],
    ["checksum", "text"],
    ["last_ok_at", "timestamptz"],
    // When this table was last proved equal to the source. Deletes on a watermarked
    // table are invisible to any timestamp, so equality has to be checked on a
    // schedule rather than inferred from a successful pull.
    ["last_verify_at", "timestamptz"],
    ["last_error", "text"],
    // A `full` parent's children are not in yet. Set before the parent is replaced,
    // cleared by recordSuccess once pass 2 has pulled its children. A full table has
    // no watermark to hold back, and its fingerprint matches as soon as the parent
    // landed — so without this, a cycle killed between the passes (or a child pull that
    // failed) left those children behind until the hourly reconcile.
    ["children_pending", "boolean NOT NULL DEFAULT false"],
];

async function ensure(client) {
    await ensureTable(client, TABLE, COLUMNS);
}

/**
 * Where to resume this table's delta pull - or nowhere, when the registry has changed
 * what the stored cursor MEANS.
 *
 * Returns `{ since, sinceId, reason }`. `reason` is null in the ordinary case and a
 * printable sentence when the cursor definition has moved; in that case the cursor is
 * dropped and the table re-drains from the beginning. That is the cheap outcome: a
 * re-drain costs one pass, whereas a mis-read cursor costs rows that never arrive at
 * all and nothing to notice it by.
 *
 * A NULL `cursor_column` is deliberately NOT treated as a change. Every replica has
 * one on the first cycle after this column ships, and resetting on that would re-read
 * all ~111 tables out of Supabase - exactly the egress this engine exists to avoid.
 * `strategy` has always been stored, and it carries the transition that matters today
 * (append -> watermark) on its own.
 */
function cursorFor(row, entry) {
    const none = { since: null, sinceId: null, reason: null };
    if (!row) return none;

    const wantColumn = entry.column || null;
    if (row.strategy !== entry.strategy) {
        return { ...none, reason: `strategy changed (${row.strategy} -> ${entry.strategy}) - cursor reset` };
    }
    if (row.cursor_column != null && row.cursor_column !== wantColumn) {
        return { ...none, reason: `cursor column changed (${row.cursor_column} -> ${wantColumn}) - cursor reset` };
    }
    return { since: row.watermark || null, sinceId: row.watermark_id != null ? row.watermark_id : null, reason: null };
}

/** @returns {Promise<Map<number, any>>} */
async function readAll(client) {
    const { rows } = await client.query(`SELECT * FROM ${q(TABLE)}`);
    return new Map(rows.map((r) => [r.table_num, r]));
}

async function recordSuccess(client, entry, model, watermark, watermarkId) {
    await client.query(
        `INSERT INTO ${q(TABLE)} (table_num, model, table_name, strategy, cursor_column, watermark, watermark_id, last_ok_at, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), NULL)
         ON CONFLICT (table_num) DO UPDATE SET
           model = EXCLUDED.model,
           table_name = EXCLUDED.table_name,
           strategy = EXCLUDED.strategy,
           cursor_column = EXCLUDED.cursor_column,
           -- Never move a watermark backwards. A cycle that legitimately finds
           -- nothing new returns null, and letting that overwrite a real high-water
           -- mark would re-pull the table from the beginning next time.
           watermark = COALESCE(EXCLUDED.watermark, ${q(TABLE)}.watermark),
           watermark_id = CASE WHEN EXCLUDED.watermark IS NULL
                               THEN ${q(TABLE)}.watermark_id
                               ELSE EXCLUDED.watermark_id END,
           last_ok_at = now(),
           last_error = NULL,
           children_pending = false`,
        [entry.n, model, entry.table, entry.strategy, entry.column || null, watermark || null, watermarkId != null ? String(watermarkId) : null],
    );
}

/** A full parent is about to be replaced; its children follow in pass 2. See COLUMNS. */
async function markChildrenPending(client, entry, model) {
    await client.query(
        `INSERT INTO ${q(TABLE)} (table_num, model, table_name, strategy, children_pending)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (table_num) DO UPDATE SET children_pending = true`,
        [entry.n, model, entry.table, entry.strategy],
    );
}

async function recordFailure(client, entry, model, err) {
    await client.query(
        `INSERT INTO ${q(TABLE)} (table_num, model, table_name, strategy, last_error)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (table_num) DO UPDATE SET last_error = EXCLUDED.last_error`,
        [entry.n, model, entry.table, entry.strategy, String(err && err.message ? err.message : err).slice(0, 2000)],
    );
}

/** Stamp a table as proved equal to the source, with the fingerprint that proved it. */
async function recordVerified(client, entry, count, checksum) {
    await client.query(
        `UPDATE ${q(TABLE)} SET last_verify_at = now(), row_count = $2, checksum = $3 WHERE table_num = $1`,
        [entry.n, count, checksum],
    );
}

/** Drop rows for table numbers no longer in the registry (retired or server-only models). */
async function pruneExcept(client, nums) {
    await client.query(`DELETE FROM ${q(TABLE)} WHERE NOT (table_num = ANY($1::int[]))`, [nums]);
}

module.exports = { ensure, pruneExcept, readAll, cursorFor, recordSuccess, recordFailure, recordVerified, markChildrenPending, TABLE };
