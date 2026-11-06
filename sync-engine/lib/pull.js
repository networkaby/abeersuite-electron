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
const { keyExpression, stampExpression } = require("./reconcile");
const outboxGuard = require("./outboxGuard");
const totals = require("./rebuildTotals");

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
 * table -> { keys: [[{ name, type }]], pkTypes } — the table's plain unique indexes
 * other than the primary key (Prisma's @unique / @@unique), plus the primary key's
 * column types. Read once per process.
 */
const uniqueCache = new Map();

async function uniqueKeysOf(client, table, pk) {
    if (uniqueCache.has(table)) return uniqueCache.get(table);
    const rel = `public.${q(table)}`;
    const { rows } = await client.query(
        `SELECT array_agg(a.attname::text ORDER BY k.ord) AS names,
                array_agg(format_type(a.atttypid, a.atttypmod) ORDER BY k.ord) AS types
           FROM pg_index i
           CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = to_regclass($1)
            AND i.indisunique AND NOT i.indisprimary
            AND i.indexprs IS NULL AND i.indpred IS NULL
          GROUP BY i.indexrelid`,
        [rel],
    );
    const pkRes = await client.query(
        `SELECT attname::text AS attname, format_type(atttypid, atttypmod) AS t
           FROM pg_attribute WHERE attrelid = to_regclass($1) AND attname = ANY($2)`,
        [rel, pk],
    );
    const pkType = new Map(pkRes.rows.map((r) => [r.attname, r.t]));
    const out = {
        keys: rows.map((r) => r.names.map((name, n) => ({ name, type: r.types[n] }))),
        pkTypes: pk.map((p) => pkType.get(p)),
    };
    uniqueCache.set(table, out);
    return out;
}

/**
 * Clear the way for rows whose UNIQUE value (not primary key) is held here by a
 * DIFFERENT row.
 *
 * ON CONFLICT only handles the primary key. When a value moves from one row to
 * another on the source — group 102 "Converter & Adapter" deleted, group 61 renamed to
 * it — this replica still has 102 holding the name, so 61's update fails on
 * `InvProductGroup_name_key` and the whole table stops syncing, every cycle, forever.
 * Reordering cannot fix it: a swap (A↔B) has no valid order at all. Checked before
 * every chunk; tables with no unique index other than the key pay one cached lookup.
 *
 * The source is the truth, and it can hold the value on only one row, so the local
 * holder is stale: either deleted upstream (reconcile would remove it anyway) or
 * itself changed upstream (its fresh copy arrives in this or a later page and is
 * re-inserted). It is deleted here, inside the caller's replica-role transaction —
 * foreign keys are suspended, so rows that point at it are untouched and keep their
 * reference for when it returns.
 *
 * A row this counter wrote and has not pushed yet is never touched (outboxGuard):
 * the insert then fails as before and the badge shows it, rather than losing the
 * only copy.
 */
async function clearUniqueClashes(client, table, pk, batch) {
    const { keys, pkTypes } = await uniqueKeysOf(client, table, pk);
    if (keys.length === 0) return 0;
    const entry = { table, pk };
    const keyExpr = keyExpression(entry);
    let pending = null;
    let cleared = 0;

    for (const cols of keys) {
        if (!cols.every((c) => c.name in batch[0])) continue;
        const names = [...cols.map((c) => c.name), ...pk];
        const types = [...cols.map((c) => c.type), ...pkTypes];
        const params = [];
        const tuples = [];
        for (const row of batch) {
            if (cols.some((c) => row[c.name] == null)) continue; // NULLs never clash
            tuples.push(`(${names.map((name, n) => {
                params.push(row[name]);
                return `$${params.length}::${types[n]}`;
            }).join(", ")})`);
        }
        if (tuples.length === 0) continue;

        const vCols = [...cols.map((_, n) => `u${n}`), ...pk.map((_, n) => `p${n}`)];
        const sameValue = cols.map((c, n) => `l.${q(c.name)} = v.u${n}`).join(" AND ");
        const samePk = pk.map((p, n) => `l.${q(p)} = v.p${n}`).join(" AND ");
        // The CTE exposes the holder's own columns unqualified, so keyExpression
        // (written for a bare table) applies as-is.
        const holders = await client.query(
            `WITH h AS (
                 SELECT l.* FROM ${q(table)} l
                 JOIN (VALUES ${tuples.join(", ")}) AS v(${vCols.join(", ")}) ON ${sameValue}
                 WHERE NOT (${samePk}))
             SELECT ${keyExpr} AS k FROM h`,
            params,
        );
        if (holders.rows.length === 0) continue;

        pending ??= await outboxGuard.pendingKeys(client, entry);
        const stale = holders.rows.map((r) => r.k).filter((k) => !pending.has(k));
        if (stale.length === 0) continue;
        await totals.noteBeforeDelete(client, table, `${keyExpr} = ANY($1)`, [stale]);
        const r = await client.query(`DELETE FROM ${q(table)} WHERE ${keyExpr} = ANY($1)`, [stale]);
        cleared += r.rowCount || 0;
        console.log(`[sync] ${table}: cleared ${r.rowCount} stale row(s) holding a unique value now on another row upstream (${stale.slice(0, 10).join(", ")})`);
    }
    return cleared;
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
async function upsert(client, table, pk, rows, jsonCols, cacheCols, force) {
    if (rows.length === 0) return 0;
    const json = jsonCols || new Set();
    const cache = new Set(cacheCols || []);

    const cols = Object.keys(rows[0]);
    const colSql = cols.map(q).join(", ");
    const conflict = pk.map(q).join(", ");
    // Every non-key column is refreshed. Listing them explicitly (rather than using
    // EXCLUDED.*) keeps the statement valid if the row shape ever narrows.
    //
    // Except a running total (`cacheColumns` in the registry): the source's
    // stock is the SOURCE's sum, and this replica may hold sales the source
    // has not received yet. The total is inserted with a new row (NOT NULL) but never
    // overwritten on an existing one; rebuildTotals.js re-sums it from the local
    // ledger once this cycle's ledger rows are in.
    const updates = cols.filter((c) => !pk.includes(c) && !cache.has(c));
    const hasUpdatedAt = cols.includes("updatedAt");
    const setSql = updates.length
        ? updates.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")
        : null;
    // The monotonic guard: never let an older copy of a row overwrite a newer one, for
    // pulls that can arrive out of order.
    //
    // `force` turns it off, and a reconcile-driven repair MUST turn it off. The whole
    // class of divergence that repair exists for is a row whose content differs while
    // `updatedAt` is IDENTICAL on both sides — a foreign key's ON DELETE SET NULL fires
    // inside PostgreSQL, so Prisma's @updatedAt never runs. Against equal timestamps
    // `EXCLUDED.updatedAt > table.updatedAt` is false, so the row is silently not
    // written and the repair reports success having done nothing. Reconciliation has
    // just proved the source's copy is the truth; it does not need a tiebreak.
    const guardSql = hasUpdatedAt && !force
        ? ` WHERE ${q(table)}.${q("updatedAt")} IS NULL OR EXCLUDED.${q("updatedAt")} > ${q(table)}.${q("updatedAt")}`
        : "";

    let written = 0;
    for (const batch of chunk(rows, CHUNK)) {
        await clearUniqueClashes(client, table, pk, batch);
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
    await totals.noteRows(client, table, rows);
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
async function pullWatermark(source, local, entry, since, sinceId, limit, force) {
    const col = entry.column;
    // Compound-key tables cannot express this cursor; InvProductBranch and
    // VoucherSeriesCounter are both compound-keyed and watermarked, and they fall back
    // to the timestamp alone. Safe there because a tie would have to exceed a whole
    // page to lose anything.
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
    // `force` is passed only on the cycle where this table's cursor definition changed
    // (see state.cursorFor). The monotonic guard exists to stop an OLDER copy of a row
    // overwriting a newer local one — but on that one cycle the two sides' `updatedAt`
    // values are not comparable at all: one is the backfill stamped when the source got
    // the column, the other the backfill stamped when this replica's schema was
    // re-applied. Whichever happened later wins an argument it was never in. Leaving the
    // guard on there is what silently discards the whole re-drain, which is exactly the
    // failure this reset exists to repair.
    await inReplicaTransaction(local, () => upsert(local, entry.table, entry.pk, rows, jsonCols, entry.cacheColumns, force));

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
        await upsert(local, entry.table, entry.pk, rows, jsonCols, entry.cacheColumns);
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
        // The lines about to be replaced may point at accounts the new set does not.
        await totals.noteBeforeDelete(local, entry.table, `${q(entry.fk)} = ANY($1)`, [parentIds]);
        await local.query(`DELETE FROM ${q(entry.table)} WHERE ${q(entry.fk)} = ANY($1)`, [parentIds]);
        await upsert(local, entry.table, entry.pk, rows, jsonCols, entry.cacheColumns);
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
async function pullByKeys(source, local, entry, keys, force = true) {
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
        // `force` defaults ON here, unlike the ordinary pulls: every caller of this
        // function is reconciliation, which has just compared the two sides and knows
        // the source's copy is the truth. Leaving the monotonic guard in place would
        // make it a no-op against equal timestamps — see upsert.
        await inReplicaTransaction(local, () => upsert(local, entry.table, entry.pk, res.rows, jsonCols, entry.cacheColumns, force));
        written += res.rows.length;
    }
    return written;
}

/**
 * Overwrite rows here with the source's copy — except the ones this counter still owes
 * the source.
 *
 * For rows on both sides that disagree (reconcile.keyDiff's `stale`). The source is the
 * authority, so this forces past the monotonic guard like every reconcile repair — which
 * is what makes the push's "dropped, the counter converges at the next pull" true for an
 * edit the office refused (an un-posting replay, a write to a closed shift): that row's
 * cloud stamp sits behind every cursor, so no pull would ever bring it back.
 *
 * Same two holds as deleteByKeys, for the same reason, kept inside the function so no
 * caller can forget them: a `localAuthority` table refreshes nothing, and a row still
 * waiting in `_outbox` is this counter's newer edit, not drift.
 *
 * @returns {Promise<{ refreshed: number, heldKeys: string[] }>}
 */
async function refreshByKeys(source, local, entry, keys) {
    const out = { refreshed: 0, heldKeys: [] };
    if (!keys || keys.length === 0) return out;

    if (entry.localAuthority) {
        out.heldKeys = [...keys];
        return out;
    }
    const pending = await outboxGuard.pendingKeys(local, entry);
    const take = [];
    for (const k of keys) (pending.has(k) ? out.heldKeys : take).push(k);
    out.refreshed = await pullByKeys(source, local, entry, take);
    return out;
}

/**
 * Which watermark / append tables have a row past their cursor — ONE round trip for all
 * of them.
 *
 * Every change signal wakes every counter, and each wake used to send one `SELECT *`
 * per table. Nearly all of those came back empty, and an empty `SELECT *` still carries
 * the full column description, so the "nothing moved" answer was most of the Supabase
 * egress (pg_stat_statements, 3 Nov 2026: ~63k empty probes per config table). This asks
 * the drain's own WHERE as an EXISTS per table and returns only the tables that said yes.
 *
 * `checks` is `[{ model, entry, since, sinceId }]`; a table with no cursor is not asked
 * (it is always drained). Returns the Set of models that moved, or null when the probe
 * itself failed — the caller then drains every table, exactly as before.
 */
async function probeMoved(source, checks) {
    const asked = checks.filter((c) => c.since);
    if (asked.length === 0) return new Set();
    const params = [];
    const parts = asked.map((c, i) => {
        const col = q(c.entry.column);
        const keyed = c.entry.pk.length === 1 && c.sinceId != null;
        params.push(c.since);
        let pred = `${col} > $${params.length}`;
        if (keyed) {
            params.push(c.sinceId);
            pred = `(${col}, ${q(c.entry.pk[0])}::text) > ($${params.length - 1}, $${params.length})`;
        }
        return `SELECT ${i} AS i WHERE EXISTS (SELECT 1 FROM ${q(c.entry.table)} WHERE ${pred})`;
    });
    try {
        const { rows } = await source.query(parts.join(" UNION ALL "), params);
        return new Set(rows.map((r) => asked[r.i].model));
    } catch (e) {
        console.log(`  probe failed (${e.code || e.message}) - draining every table this cycle`);
        return null;
    }
}

/** How far behind its cursor a table is re-checked for late commits. */
const LATE_WINDOW_MS = 60 * 1000;
/** A cursor older than this is not re-checked: nothing can still be committing behind it.
 *  Longer than index.js's 10-minute interval, so a late commit no signal announces is
 *  still caught by the next scheduled cycle. */
const LATE_HORIZON_MS = 15 * 60 * 1000;

/**
 * A source `timestamp` (no zone) reaches JS as a Date read in LOCAL time, so its
 * wall-clock fields — not its epoch — hold the stored UTC value. This is that value.
 */
function storedUtcMs(d) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/**
 * Pull rows stamped just BEHIND the cursor that this replica holds an older copy of, or
 * none at all.
 *
 * The cursor is the largest stamp SEEN, and a stamp is taken when the writer's statement
 * runs, not when its transaction commits. A voucher save stamped 10:00:00 that commits at
 * 10:00:05 is invisible to a pull at 10:00:02, which may carry the cursor to 10:00:01 —
 * and every later pull starts past it. A new row then waited for the hourly reconcile; an
 * EDIT was never repaired at all before the stamped fingerprint (reconcile.js, job 3).
 *
 * So each cycle first compares key + stamp over the last LATE_WINDOW_MS behind the cursor
 * the previous cycle left, and pulls what is newer upstream: one source query returning a
 * handful of (key, stamp) pairs, one local lookup. Skipped outright once the cursor is
 * older than LATE_HORIZON_MS, which keeps a quiet table at zero extra round trips.
 *
 * The ordinary monotonic guard applies (`force` off): this is a delta pull reaching back,
 * not a reconcile, and a newer local edit wins here exactly as it does against a page.
 * Rows at or ahead of the (stamp, id) cursor are left to the drain that follows.
 *
 * @returns {Promise<{ pulled: number, ids: string[] }>} `ids` (single-column keys only)
 *   go to the children, exactly as a page's do: a late voucher edit brings its lines.
 */
async function recheckBehindCursor(source, local, entry, since, sinceId) {
    const none = { pulled: 0, ids: [] };
    if (!since || !entry.column) return none;
    const at = since instanceof Date ? since : new Date(since);
    if (Number.isNaN(at.getTime()) || Date.now() - storedUtcMs(at) > LATE_HORIZON_MS) return none;

    const col = q(entry.column);
    const keyExpr = keyExpression(entry);
    const stamp = stampExpression(entry.column);
    const keyed = entry.pk.length === 1 && sinceId != null;
    const { rows } = await source.query(
        `SELECT ${keyExpr} AS k, ${stamp} AS s FROM ${q(entry.table)}
          WHERE ${col} > $1
            AND ${keyed ? `(${col}, ${q(entry.pk[0])}::text) <= ($2, $3)` : `${col} <= $2`}`,
        keyed ? [new Date(at.getTime() - LATE_WINDOW_MS), at, sinceId] : [new Date(at.getTime() - LATE_WINDOW_MS), at],
    );
    if (rows.length === 0) return none;

    const here = await local.query(
        `SELECT ${keyExpr} AS k, ${stamp} AS s FROM ${q(entry.table)} WHERE ${keyExpr} = ANY($1)`,
        [rows.map((r) => r.k)],
    );
    const mine = new Map(here.rows.map((r) => [r.k, r.s]));
    // Fixed-width stamps (stampExpression), so text order is time order.
    const behind = rows.filter((r) => !mine.has(r.k) || mine.get(r.k) < r.s).map((r) => r.k);
    if (behind.length === 0) return none;

    const pulled = await pullByKeys(source, local, entry, behind, false);
    return { pulled, ids: entry.pk.length === 1 ? behind : [] };
}

/**
 * Remove rows the source no longer has — except the ones the source has never SEEN.
 *
 * `keys` is "present here, absent upstream". Two very different things look like
 * that: a row the office deleted, and a row this counter created and has not pushed
 * yet. The guard lives inside this function rather than at its callers so that no
 * call site, present or future, can delete the second kind by forgetting to ask.
 *
 * Two holds, each for its own reason:
 *   - `entry.localAuthority` — this machine owns its rows in the table outright and
 *     the cloud is never the authority on them (VoucherSeriesCounter: one row per
 *     counter, and losing it re-issues printed invoice numbers). Nothing is deleted,
 *     pushed or not.
 *   - the outbox — a row still waiting to be pushed (see outboxGuard.js).
 *
 * @returns {{ removed: number, deletedKeys: string[], heldKeys: string[] }}
 *   `deletedKeys` is what repairReferencing should act on; `heldKeys` is for the log.
 */
async function deleteByKeys(local, entry, keys) {
    const out = { removed: 0, deletedKeys: [], heldKeys: [] };
    if (!keys || keys.length === 0) return out;

    if (entry.localAuthority) {
        out.heldKeys = [...keys];
        return out;
    }
    const pending = await outboxGuard.pendingKeys(local, entry);
    for (const k of keys) (pending.has(k) ? out.heldKeys : out.deletedKeys).push(k);
    if (out.deletedKeys.length === 0) return out;

    const keyExpr = keyExpression(entry);

    for (const batch of chunk(out.deletedKeys, CHUNK)) {
        const r = await inReplicaTransaction(local, async () => {
            await totals.noteBeforeDelete(local, entry.table, `${keyExpr} = ANY($1)`, [batch]);
            return local.query(`DELETE FROM ${q(entry.table)} WHERE ${keyExpr} = ANY($1)`, [batch]);
        });
        out.removed += r.rowCount || 0;
    }
    return out;
}

module.exports = {
    pullWatermark, pullFull, pullChildren, pullByKeys, refreshByKeys, recheckBehindCursor, probeMoved, deleteByKeys,
    upsert, jsonColumnsOf, coerce, CHUNK,
};
