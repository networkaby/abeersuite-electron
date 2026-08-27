"use strict";

/**
 * The four sync strategies.
 *
 * Every one of them moves whole ROWS as the source returns them, with only one
 * deliberate conversion (see jsonColumnsOf). node-postgres decodes and re-encodes
 * every other type consistently - numeric and int8 as strings, timestamps as Date,
 * bytea as Buffer - so a value read from the source and handed back round-trips
 * intact. Converting more by hand would be a chance to lose precision on a Decimal,
 * which is money.
 */

const { q, inReplicaTransaction } = require("./db");
const { keyExpression } = require("./reconcile");

/** Rows per INSERT. Postgres caps a statement at 65535 parameters. */
const CHUNK = 500;

/** pg_type OIDs for json and jsonb, and their array forms. */
const JSON_OIDS = new Set([114, 3802, 199, 3807]);

/**
 * Which columns are json/jsonb, read from the result metadata that comes free with
 * every query - no extra round trip.
 *
 * This is not optional bookkeeping. node-postgres decodes a jsonb column holding a
 * JSON ARRAY into a JS array, and then re-encodes any JS array as a POSTGRES array
 * literal ({500,200,100}) rather than as JSON. Feeding that back into a jsonb column
 * fails with "invalid input syntax for type json". JSON OBJECTS survive the trip
 * (pg stringifies a plain object), so the bug hides until a row happens to hold an
 * array - which is why it took real data to find: it broke OrgDefaults and PosCounter
 * while every other jsonb table passed.
 */
function jsonColumnsOf(fields) {
    const out = new Set();
    for (const f of fields || []) if (JSON_OIDS.has(f.dataTypeID)) out.add(f.name);
    return out;
}

/** Serialise json/jsonb values ourselves so arrays are not mangled into array literals. */
function coerce(value, isJson) {
    if (!isJson || value === null || value === undefined) return value;
    // Already text (some drivers/columns hand back a string) - leave it alone.
    if (typeof value === "string") return value;
    return JSON.stringify(value);
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * INSERT ... ON CONFLICT (pk) DO UPDATE, in chunks.
 *
 * Columns are taken from the row objects themselves, so a column added on the source
 * before the replica's schema catches up would be an error here rather than silent
 * data loss -- which is what the schema guard exists to catch first.
 *
 * ── Last-write-wins, when the row carries updatedAt ──────────────────────────
 * A CREATE never collides here: offline creates mint an id from this counter's own
 * reserved block, which cannot already exist in cloud, so there is nothing to
 * conflict with. The real exposure is an EDIT to a row that exists on both
 * sides -- an offline edit racing a pull cycle. Without a guard, whichever side's
 * write happens to arrive over the wire last always wins, regardless of which one
 * is actually newer. When the row has an `updatedAt` column, the conflict update
 * is guarded so an older incoming row can never overwrite a newer local edit; a
 * row with no `updatedAt` (most append/full reference tables) keeps the previous
 * unconditional behaviour.
 */
async function upsert(client, table, pk, rows, jsonCols) {
    if (rows.length === 0) return 0;
    const json = jsonCols || new Set();

    const cols = Object.keys(rows[0]);
    const colSql = cols.map(q).join(", ");
    const conflict = pk.map(q).join(", ");
    // Every non-key column is refreshed. Listing them explicitly (rather than using
    // EXCLUDED.*) keeps the statement valid if the row shape ever narrows.
    const updates = cols.filter((c) => !pk.includes(c));
    const hasUpdatedAt = cols.includes("updatedAt");
    const setSql = updates.length
        ? updates.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")
        : null;
    const guardSql = hasUpdatedAt
        ? ` WHERE ${q(table)}.${q("updatedAt")} IS NULL OR EXCLUDED.${q("updatedAt")} > ${q(table)}.${q("updatedAt")}`
        : "";

    let written = 0;
    for (const batch of chunk(rows, CHUNK)) {
        const params = [];
        const tuples = batch.map((row) => {
            const ph = cols.map((c) => {
                params.push(coerce(row[c], json.has(c)));
                return `$${params.length}`;
            });
            return `(${ph.join(", ")})`;
        });
        const sql =
            `INSERT INTO ${q(table)} (${colSql}) VALUES ${tuples.join(", ")} ` +
            (setSql
                ? `ON CONFLICT (${conflict}) DO UPDATE SET ${setSql}${guardSql}`
                // A table whose columns are ALL key columns (a pure join table) has
                // nothing to update; the row either exists or does not.
                : `ON CONFLICT (${conflict}) DO NOTHING`);
        await client.query(sql, params);
        written += batch.length;
    }
    return written;
}

/**
 * watermark / append: pull rows past the last cursor.
 *
 * THE CURSOR IS (timestamp, primary key), NOT the timestamp alone.
 *
 * Timestamps are not unique, and not nearly unique enough to hand-wave: a bulk
 * import stamps every row it touches identically -- Person carries 3529 rows sharing
 * one `updatedAt`. With a timestamp-only cursor, a page ending anywhere inside such
 * a block advances the mark past the whole block, and every remaining row in it
 * becomes permanently invisible. No error, no retry, no way to notice; the rows
 * simply never arrive. Adding the primary key makes the ordering total, so a page
 * boundary can fall inside a tie without losing anything.
 *
 * The new cursor is the largest value SEEN, never `now()`. Taking the clock would
 * skip any row committed during the query but stamped just before it -- the same
 * silent hole by a different route.
 *
 * `limit` bounds one cycle so a long-offline counter catches up in steps rather than
 * buffering an unbounded backlog; `more` tells the caller to come straight back.
 */
async function pullWatermark(source, local, entry, since, sinceId, limit) {
    const col = entry.column;
    // Compound-key tables cannot express this cursor; only InvProductBranch is both
    // compound-keyed and watermarked, and it falls back to the timestamp alone.
    // Safe there because a tie would have to exceed a whole page to lose anything.
    const keyed = entry.pk.length === 1;
    const idCol = entry.pk[0];

    let where = "";
    const params = [];
    if (since && keyed && sinceId != null) {
        params.push(since, sinceId);
        where = `WHERE (${q(col)}, ${q(idCol)}::text) > ($1, $2)`;
    } else if (since) {
        params.push(since);
        where = `WHERE ${q(col)} > $1`;
    }
    params.push(limit);

    const orderBy = keyed ? `${q(col)} ASC, ${q(idCol)}::text ASC` : `${q(col)} ASC`;
    const res = await source.query(
        `SELECT * FROM ${q(entry.table)} ${where} ORDER BY ${orderBy} LIMIT $${params.length}`,
        params,
    );
    const rows = res.rows;
    if (rows.length === 0) return { pulled: 0, watermark: null, watermarkId: null, ids: [], more: false };

    const jsonCols = jsonColumnsOf(res.fields);
    await inReplicaTransaction(local, () => upsert(local, entry.table, entry.pk, rows, jsonCols));

    const last = rows[rows.length - 1];
    return {
        pulled: rows.length,
        watermark: last[col],
        watermarkId: keyed ? last[idCol] : null,
        ids: keyed ? rows.map((r) => r[idCol]) : [],
        more: rows.length >= limit,
    };
}

/**
 * full: replace the table wholesale.
 *
 * Only for small reference tables. It is the one strategy that is exact for deletes
 * without any extra machinery, which is why the registry steers config tables here:
 * a revoked permission or a deleted department must not linger until the next
 * reconciliation sweep.
 */
async function pullFull(source, local, entry) {
    const res = await source.query(`SELECT * FROM ${q(entry.table)}`);
    const rows = res.rows;
    const jsonCols = jsonColumnsOf(res.fields);
    await inReplicaTransaction(local, async () => {
        // DELETE, not TRUNCATE: TRUNCATE on a referenced table demands CASCADE, and
        // CASCADE would silently empty the tables pointing at it.
        await local.query(`DELETE FROM ${q(entry.table)}`);
        await upsert(local, entry.table, entry.pk, rows, jsonCols);
    });
    const idCol = entry.pk[0];
    return {
        pulled: rows.length,
        watermark: null,
        ids: entry.pk.length === 1 ? rows.map((r) => r[idCol]) : [],
    };
}

/**
 * child: replace the child set of every parent that moved.
 *
 * This is what makes child deletes exact. A watermark can only ever say "this row
 * changed"; it can never say "this row is gone". Re-materialising the whole set for
 * a moved parent makes a deleted line indistinguishable from an edited one, with no
 * tombstone and no sweep.
 *
 * Nothing to do when no parent moved -- which is the common case, and why this is
 * cheap despite replacing whole sets.
 */
async function pullChildren(source, local, entry, parentIds) {
    if (!parentIds || parentIds.length === 0) return { pulled: 0, watermark: null, ids: [] };

    const res = await source.query(
        `SELECT * FROM ${q(entry.table)} WHERE ${q(entry.fk)} = ANY($1)`,
        [parentIds],
    );
    const rows = res.rows;
    const jsonCols = jsonColumnsOf(res.fields);

    await inReplicaTransaction(local, async () => {
        await local.query(`DELETE FROM ${q(entry.table)} WHERE ${q(entry.fk)} = ANY($1)`, [parentIds]);
        await upsert(local, entry.table, entry.pk, rows, jsonCols);
    });

    const idCol = entry.pk[0];
    return {
        pulled: rows.length,
        watermark: null,
        // Passed on so a child-of-a-child knows which of ITS parents were rewritten.
        ids: entry.pk.length === 1 ? rows.map((r) => r[idCol]) : [],
    };
}

/**
 * Fetch specific rows by primary key and upsert them.
 *
 * The repair arm of reconciliation: rows the source has and we do not, whose
 * timestamps sit BEHIND our cursor. A delta pull will never look at them again, so
 * without this they stay missing for the life of the replica.
 */
async function pullByKeys(source, local, entry, keys) {
    if (!keys || keys.length === 0) return 0;

    const keyExpr = keyExpression(entry);

    let written = 0;
    for (const batch of chunk(keys, CHUNK)) {
        const res = await source.query(
            `SELECT * FROM ${q(entry.table)} WHERE ${keyExpr} = ANY($1)`,
            [batch],
        );
        if (res.rows.length === 0) continue;
        const jsonCols = jsonColumnsOf(res.fields);
        await inReplicaTransaction(local, () => upsert(local, entry.table, entry.pk, res.rows, jsonCols));
        written += res.rows.length;
    }
    return written;
}

/** Remove rows the source no longer has. */
async function deleteByKeys(local, entry, keys) {
    if (!keys || keys.length === 0) return 0;

    const keyExpr = keyExpression(entry);

    let removed = 0;
    for (const batch of chunk(keys, CHUNK)) {
        const r = await inReplicaTransaction(local, () =>
            local.query(`DELETE FROM ${q(entry.table)} WHERE ${keyExpr} = ANY($1)`, [batch]));
        removed += r.rowCount || 0;
    }
    return removed;
}

module.exports = { pullWatermark, pullFull, pullChildren, pullByKeys, deleteByKeys, upsert, jsonColumnsOf, coerce, CHUNK };
