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

const TABLE = "_sync_state";

const DDL = `
CREATE TABLE IF NOT EXISTS ${q(TABLE)} (
  table_num   integer PRIMARY KEY,
  model       text        NOT NULL,
  table_name  text        NOT NULL,
  strategy    text        NOT NULL,
  -- High-water mark for watermark/append tables: the largest source timestamp
  -- known to have been pulled. NULL means "never synced".
  watermark   timestamptz,
  -- Tie-breaker for that timestamp. Timestamps are NOT unique: a bulk import can
  -- stamp thousands of rows identically (Person has 3529 rows sharing one value).
  -- With a timestamp-only cursor, a page that ends inside such a block advances the
  -- watermark past it and the remainder becomes permanently invisible - no error,
  -- no retry, just rows that never arrive. Pagination is therefore keyed on
  -- (watermark, watermark_id), which is a total order.
  watermark_id text,
  row_count   bigint,
  checksum    text,
  last_ok_at  timestamptz,
  -- When this table was last proved equal to the source. Deletes on a watermarked
  -- table are invisible to any timestamp, so equality has to be checked on a
  -- schedule rather than inferred from a successful pull.
  last_verify_at timestamptz,
  last_error  text
);
`;

async function ensure(client) {
    await client.query(DDL);
    // Additive upgrade for a replica whose _sync_state predates the tie-breaker.
    await client.query(`ALTER TABLE ${q(TABLE)} ADD COLUMN IF NOT EXISTS watermark_id text`);
    await client.query(`ALTER TABLE ${q(TABLE)} ADD COLUMN IF NOT EXISTS last_verify_at timestamptz`);
}

/** @returns {Promise<Map<number, any>>} */
async function readAll(client) {
    const { rows } = await client.query(`SELECT * FROM ${q(TABLE)}`);
    return new Map(rows.map((r) => [r.table_num, r]));
}

async function recordSuccess(client, entry, model, watermark, watermarkId) {
    await client.query(
        `INSERT INTO ${q(TABLE)} (table_num, model, table_name, strategy, watermark, watermark_id, last_ok_at, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
         ON CONFLICT (table_num) DO UPDATE SET
           model = EXCLUDED.model,
           table_name = EXCLUDED.table_name,
           strategy = EXCLUDED.strategy,
           -- Never move a watermark backwards. A cycle that legitimately finds
           -- nothing new returns null, and letting that overwrite a real high-water
           -- mark would re-pull the table from the beginning next time.
           watermark = COALESCE(EXCLUDED.watermark, ${q(TABLE)}.watermark),
           watermark_id = CASE WHEN EXCLUDED.watermark IS NULL
                               THEN ${q(TABLE)}.watermark_id
                               ELSE EXCLUDED.watermark_id END,
           last_ok_at = now(),
           last_error = NULL`,
        [entry.n, model, entry.table, entry.strategy, watermark || null, watermarkId != null ? String(watermarkId) : null],
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

module.exports = { ensure, readAll, recordSuccess, recordFailure, recordVerified, TABLE };
