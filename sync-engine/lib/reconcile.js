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
 * hashtextextended is stable across servers for a given input and seed, so the two
 * sides are genuinely comparable; ordering does not matter because sum() is
 * commutative.
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
 * @returns {Promise<{ count: string, checksum: string }>}
 */
async function fingerprint(client, entry) {
    const keyExpr = keyExpression(entry);

    const { rows } = await client.query(
        `SELECT count(*)::text AS count,
                COALESCE(sum(hashtextextended(${keyExpr}, 0)), 0)::text AS checksum
         FROM ${q(entry.table)}`,
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
