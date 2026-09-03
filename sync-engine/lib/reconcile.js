"use strict";

/**
 * Cheap "has this table changed at all?" fingerprint: a row count and a hash of
 * every primary key, in one aggregate query returning two numbers.
 *
 * Used for two different jobs, and it is worth being clear that they are different:
 *
 *   1. SKIPPING A FULL COPY. A 'full' table is replaced wholesale every cycle, which
 *      would re-read every row from Supabase forever - for reference tables that
 *      change perhaps monthly. Since egress is the entire point of this project,
 *      that is self-defeating: 22 full tables at ~1000 rows, every ten minutes, is
 *      ~144k rows a day paid for nothing. Comparing the fingerprint first turns the
 *      common case into two numbers on the wire instead of a thousand rows.
 *
 *   2. CATCHING DELETES on watermarked tables, where no timestamp can ever reveal
 *      that a row is gone.
 *
 * Why a checksum and not just a count: a count alone misses the case where one row
 * is deleted and another inserted between two cycles - the total is unchanged while
 * the contents are not. Hashing the keys catches that.
 *
 * ── Full tables hash the ROW, not the key ──────────────────────────────────
 * A key-only hash cannot see an edit in place: rename a Department, release a
 * PosCounter (boundDeviceId -> null), and count and keys are both unchanged, so the
 * table is skipped forever and the replica keeps the old value. For a watermark table
 * that is fine - updatedAt carries the edit - but a 'full' table has no watermark, so
 * the fingerprint IS its only change detector. Those tables therefore hash
 * `to_jsonb(row)`: jsonb normalises key order and value rendering, so the two servers
 * agree byte for byte.
 *
 * The replica may carry a column the source has dropped (schemaGuard tolerates that on
 * purpose), which would make the two sides disagree forever. So the SOURCE fingerprint
 * also returns its column list - in the same statement, no extra round trip - and the
 * local fingerprint hashes only those columns. The list is not taken from the schema
 * guard because a signal-woken cycle trusts a recent verdict and never runs it.
 *
 * hashtextextended is stable across servers for a given input and seed, so the two
 * sides are genuinely comparable; ordering does not matter because sum() is
 * commutative. Both pools pin the session to UTC (db.js) so a timestamptz, should one
 * ever land in a full table, renders identically on both sides.
 */

const { q } = require("./db");

/**
 * SQL that renders a row's primary key as one text value.
 *
 * Defined once and shared by everything that compares, deletes or fetches by key.
 * Four copies of this drifting apart would not raise an error - the two sides would
 * simply stop agreeing on what a key looks like, and every row would read as
 * different from itself.
 *
 * Compound keys are joined with US (0x1f), a control character that cannot occur in
 * an id, so ('a','bc') and ('ab','c') cannot collide.
 */
function keyExpression(entry) {
    return entry.pk.length === 1
        ? `${q(entry.pk[0])}::text`
        : entry.pk.map((c) => `${q(c)}::text`).join(` || '\\x1f' || `);
}

/**
 * @param {string[]} [columns] `full` tables only: hash just these columns (the
 *   source's list, as returned by the source-side call). Omitted = every column, which
 *   is right for the source itself.
 * @returns {Promise<{ count: string, checksum: string, columns?: string[] }>}
 *   `columns` is present for `full` tables: the table's column names on this side.
 */
async function fingerprint(client, entry, columns) {
    if (entry.strategy !== "full") {
        const { rows } = await client.query(
            `SELECT count(*)::text AS count,
                    COALESCE(sum(hashtextextended(${keyExpression(entry)}, 0)), 0)::text AS checksum
             FROM ${q(entry.table)}`,
        );
        return rows[0];
    }

    // Row content. With a column list, keep only those keys so a replica-only column
    // cannot make the sides disagree; the column list of THIS side rides along in the
    // same statement so the caller can pass it to the other side.
    const rowExpr = columns
        ? `COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(t)) WHERE key = ANY($1::text[])), '{}'::jsonb)`
        : `to_jsonb(t)`;
    const { rows } = await client.query(
        `SELECT count(*)::text AS count,
                COALESCE(sum(hashtextextended((${rowExpr})::text, 0)), 0)::text AS checksum,
                (SELECT array_agg(column_name::text ORDER BY column_name)
                   FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = $${columns ? 2 : 1}) AS columns
         FROM ${q(entry.table)} t`,
        columns ? [columns, entry.table] : [entry.table],
    );
    return rows[0];
}

/** True when source and replica agree on both numbers. */
function same(a, b) {
    return a && b && a.count === b.count && a.checksum === b.checksum;
}

/**
 * Which keys the two sides disagree about, in BOTH directions.
 *
 * Only run when the fingerprints disagree: it transfers every key, so it is the
 * expensive path, deliberately gated behind the cheap one.
 *
 * Both directions are needed, and they heal different faults:
 *
 *   onlyLocal  - deleted upstream. No watermark can EVER report this: a timestamp
 *                says "this row changed", never "this row is gone".
 *   onlySource - present upstream but missing here, with a timestamp already BEHIND
 *                our cursor, so no future delta pull will look at it again. Left
 *                alone it stays missing for the life of the replica.
 */
async function keyDiff(source, local, entry) {
    const keyExpr = keyExpression(entry);

    const [srcKeys, localKeys] = await Promise.all([
        source.query(`SELECT ${keyExpr} AS k FROM ${q(entry.table)}`),
        local.query(`SELECT ${keyExpr} AS k FROM ${q(entry.table)}`),
    ]);
    const live = new Set(srcKeys.rows.map((r) => r.k));
    const here = new Set(localKeys.rows.map((r) => r.k));

    return {
        onlyLocal: [...here].filter((k) => !live.has(k)),
        onlySource: [...live].filter((k) => !here.has(k)),
    };
}

module.exports = { fingerprint, same, keyDiff, keyExpression };
