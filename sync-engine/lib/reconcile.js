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
 *   3. CATCHING MISSED EDITS on watermarked tables. A delta pull only looks past its
 *      cursor, so an edit whose `updatedAt` lands BEHIND the cursor is never pulled:
 *      an office transaction that commits after a pull already passed its stamp, a
 *      counter pushing an edit it made offline an hour ago, a till whose clock is off.
 *      A key hash cannot see any of them — the key set is unchanged. So a `watermark`
 *      table hashes each key TOGETHER WITH its `updatedAt`; see STAMPED below.
 *
 * Why a checksum and not just a count: a count alone misses the case where one row
 * is deleted and another inserted between two cycles - the total is unchanged while
 * the contents are not. Hashing the keys catches that.
 *
 * ── Tables with no watermark hash the ROW, not the key ─────────────────────
 * A key-only hash cannot see an edit in place: rename a Department, release a
 * PosCounter (boundDeviceId -> null), and count and keys are both unchanged, so the
 * table is skipped forever and the replica keeps the old value. For a watermark table
 * that is fine - updatedAt carries the edit - but a table with no watermark of its own
 * has nothing else to carry it, so the fingerprint IS its only change detector. Those
 * tables therefore hash `to_jsonb(row)`: jsonb normalises key order and value
 * rendering, so the two servers agree byte for byte.
 *
 * Two strategies qualify, for the same reason:
 *
 *   'full'  - replaced wholesale, no cursor anywhere.
 *   'child' - pulled when its PARENT's updatedAt moves, which says nothing about the
 *             child. A child row edited in place without touching its parent is
 *             therefore invisible to the pull AND to a key hash. Found on a live
 *             replica on 2026-09-08: UserSurfaceSeen holding a `seenAt` two days
 *             behind the source on 7 rows, every cycle reporting the table verified.
 *             (The mirror of the 2026-09-03 bug, where child rows INSERTED without
 *             the parent moving never arrived at all.)
 *
 * The cost is a sequential scan of the child table on both sides, at most once per
 * VERIFY_INTERVAL_MS. Cheap on this schema today; the ones to watch as volume grows
 * are the line-item children - InvStockLedger, VoucherGlLine, VoucherInventoryLine,
 * TicketOrderLine.
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

/** Strategies with no watermark of their own, so the fingerprint is their only change
 *  detector and must hash the row rather than the key. See the note above. */
const HASHES_ROW_CONTENT = new Set(["full", "child"]);

/**
 * Strategies whose fingerprint carries each row's cursor stamp beside its key.
 *
 * `watermark` only. An `append` table's cursor is `createdAt`, which an edit never
 * moves, so its stamp would cost a heap read per row and catch nothing.
 *
 * And not a `localAuthority` table (VoucherSeriesCounter, UserCounterPin): this machine
 * owns its rows there and pushes them over the cloud's copy, which the office then
 * merges (`mergeSeriesCounter` keeps the higher number). The two stamps differing is
 * that design working, not drift, and a stamped hash would mismatch every hour forever.
 */
const STAMPED = new Set(["watermark"]);

/** The column whose value is compared beside the key, or null for a key-only hash. */
function stampColumn(entry) {
    return STAMPED.has(entry.strategy) && !entry.localAuthority && entry.column ? entry.column : null;
}

/**
 * SQL rendering a stamp as fixed-width text, so the two servers agree byte for byte
 * (both sessions are pinned to UTC, db.js) AND a plain string comparison orders it in
 * time — `::text` drops trailing zeros from the fraction, which breaks the second.
 * NULL renders as '' so a row with no stamp still hashes.
 */
function stampExpression(column) {
    return `COALESCE(to_char(${q(column)}, 'YYYY-MM-DD HH24:MI:SS.US'), '')`;
}

/**
 * What sits between the columns of a compound key once it is rendered as text.
 *
 * This is the FOUR characters backslash, x, 1, f — not the US control character the
 * sequence looks like. The SQL literal was written meaning 0x1f, but with
 * `standard_conforming_strings = on` (the default; db.js changes nothing) Postgres
 * takes a backslash in an ordinary string literally. It has always been four
 * characters, so it stays four: both sides of every comparison render keys with the
 * one expression below, so it is self-consistent, and changing the bytes would only
 * risk that. What must never exist is a SECOND rendering that disagrees —
 * `_outbox.row_pk` is exactly that (the trigger joins with `chr(31)`), which is why
 * outboxGuard.js builds keys from `row_key` with this constant instead. Any code that
 * needs a key outside SQL takes the separator from here.
 */
const KEY_SEPARATOR = "\\x1f";

/**
 * SQL that renders a row's primary key as one text value.
 *
 * Defined once and shared by everything that compares, deletes or fetches by key.
 * Four copies of this drifting apart would not raise an error - the two sides would
 * simply stop agreeing on what a key looks like, and every row would read as
 * different from itself.
 *
 * Compound keys are joined with KEY_SEPARATOR, a sequence that does not occur in an
 * id, so ('a','bc') and ('ab','c') cannot collide.
 */
function keyExpression(entry) {
    return entry.pk.length === 1
        ? `${q(entry.pk[0])}::text`
        : entry.pk.map((c) => `${q(c)}::text`).join(` || '${KEY_SEPARATOR}' || `);
}

/**
 * @param {string[]} [columns] `full` tables only: hash just these columns (the
 *   source's list, as returned by the source-side call). Omitted = every column, which
 *   is right for the source itself.
 * @returns {Promise<{ count: string, checksum: string, columns?: string[] }>}
 *   `columns` is present for `full` tables: the table's column names on this side.
 */
async function fingerprint(client, entry, columns) {
    if (HASHES_ROW_CONTENT.has(entry.strategy)) return contentFingerprint(client, entry, columns);

    const stamp = stampColumn(entry);
    const hashed = stamp
        ? `${keyExpression(entry)} || '${KEY_SEPARATOR}' || ${stampExpression(stamp)}`
        : keyExpression(entry);
    const { rows } = await client.query(
        `SELECT count(*)::text AS count,
                COALESCE(sum(hashtextextended(${hashed}, 0)), 0)::text AS checksum
         FROM ${q(entry.table)}`,
    );
    return rows[0];
}

/**
 * The same count + hash, but over the WHOLE ROW, for a table of any strategy.
 *
 * This is what `fingerprint` runs for a `full` table, lifted out so a watermark table
 * can be asked the same question on demand. It is deliberately NOT what the hourly
 * reconcile uses: hashing every row means reading every row on BOTH sides, and paying
 * that against Supabase on a schedule is exactly the egress this project exists to
 * avoid. See verify-replica.js --deep, which is the on-demand caller.
 *
 * Worth being precise about what only this can catch. A watermark table's changes are
 * meant to be carried by `updatedAt`, so a key hash is enough — UNLESS a row's content
 * changed without `updatedAt` moving. That is not hypothetical: a foreign key's
 * ON DELETE SET NULL fires inside PostgreSQL, so Prisma's application-level @updatedAt
 * never runs, and the replica (which applies everything under
 * `session_replication_role = replica`, suspending those same FK actions) never
 * performs the matching change. The row then differs forever: the watermark will not
 * re-pull it, and a key hash cannot see it.
 */
async function contentFingerprint(client, entry, columns) {
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
 *   stale      - on both sides, last changed at a different time: an edit the delta
 *                pull missed (see job 3 at the top). Only a stamped table (stampColumn)
 *                can report these; for every other table it is empty.
 */
async function keyDiff(source, local, entry) {
    const keyExpr = keyExpression(entry);
    const stamp = stampColumn(entry);
    const select = stamp
        ? `SELECT ${keyExpr} AS k, ${stampExpression(stamp)} AS s FROM ${q(entry.table)}`
        : `SELECT ${keyExpr} AS k FROM ${q(entry.table)}`;

    const [srcKeys, localKeys] = await Promise.all([source.query(select), local.query(select)]);
    const live = new Map(srcKeys.rows.map((r) => [r.k, r.s]));
    const here = new Map(localKeys.rows.map((r) => [r.k, r.s]));

    return {
        onlyLocal: [...here.keys()].filter((k) => !live.has(k)),
        onlySource: [...live.keys()].filter((k) => !here.has(k)),
        stale: stamp ? [...live].filter(([k, s]) => here.has(k) && here.get(k) !== s).map(([k]) => k) : [],
    };
}

/**
 * Which keys exist on BOTH sides but hold different content.
 *
 * The gap `keyDiff` cannot close. That one answers "which rows are missing or extra",
 * which is all a key hash can ever support; this answers "which rows are here on both
 * sides and disagree" — the shape a suspended FK action leaves behind.
 *
 * One row per record on the wire from each side (a key and a 64-bit hash), the same
 * order of cost as `keyDiff`, which is why this belongs to the on-demand tool rather
 * than the hourly pass.
 *
 * `columns` is the SOURCE's column list, exactly as `contentFingerprint` returns it:
 * the source hashes its whole row, the replica hashes only those columns, so a column
 * the replica still carries and the source has dropped cannot read as a difference.
 */
async function rowHashDiff(source, local, entry, columns) {
    const keyExpr = keyExpression(entry);
    const [src, loc] = await Promise.all([
        source.query(
            `SELECT ${keyExpr} AS k, hashtextextended(to_jsonb(t)::text, 0)::text AS h
               FROM ${q(entry.table)} t`,
        ),
        local.query(
            `SELECT ${keyExpr} AS k,
                    hashtextextended(
                        COALESCE((SELECT jsonb_object_agg(key, value)
                                    FROM jsonb_each(to_jsonb(t))
                                   WHERE key = ANY($1::text[])), '{}'::jsonb)::text, 0)::text AS h
               FROM ${q(entry.table)} t`,
            [columns],
        ),
    ]);

    const here = new Map(loc.rows.map((r) => [r.k, r.h]));
    const differing = [];
    for (const r of src.rows) {
        const mine = here.get(r.k);
        // `undefined` means the row is missing here, which is keyDiff's job, not ours.
        if (mine !== undefined && mine !== r.h) differing.push(r.k);
    }
    return differing;
}

/**
 * Every table that points AT `table` through a foreign key whose ON DELETE action
 * rewrites the referencing column — SET NULL ('n') or SET DEFAULT ('d').
 *
 * Why this exists. When a parent row is deleted on the source, PostgreSQL performs
 * that action there and the child row's content changes. On the replica the same
 * delete is applied under `session_replication_role = replica` (db.js), which
 * suspends FK actions on purpose so rows can land out of dependency order — so the
 * child is left holding a key that no longer exists. Neither healer notices: the
 * child's `updatedAt` never moved (the source's change was made by the database, not
 * by Prisma), and the reconcile's key hash only ever sees keys, which are unchanged
 * on both sides. The row stays wrong for the life of the replica.
 *
 * So after a delete we ask the source what those children should look like now. The
 * source is the authority; we copy its answer rather than trying to re-implement FK
 * semantics here, which would have to stay in step with 95 constraints forever.
 *
 * ON DELETE CASCADE is deliberately absent. It deletes the child outright on the
 * source, so the replica ends up with rows the source lacks — a difference in the KEY
 * set, which the ordinary fingerprint already catches on that table's next verify.
 *
 * Only single-column foreign keys are returned. Every one of this schema's 95 is
 * single-column; a composite one would need its columns matched to the parent key in
 * `confkey` order, and silently mis-matching it would be worse than skipping it.
 */
async function referencingNullers(client, table) {
    return referencing(client, table, ["n", "d"]);
}

/**
 * Single-column foreign keys onto `table` whose `ON DELETE` action is CASCADE. On the
 * source a parent delete removed these rows too; here it did not (FK actions are
 * suspended while applying), so sync-once.js reconciles these tables in the same cycle
 * as the parent it was told about.
 */
async function referencingCascades(client, table) {
    return referencing(client, table, ["c"]);
}

/** `confdeltype` codes: a = no action, r = restrict, c = cascade, n = set null, d = set default. */
async function referencing(client, table, delTypes) {
    const { rows } = await client.query(
        `SELECT c.conrelid::regclass::text AS child_table,
                a.attname                  AS child_column
           FROM pg_constraint c
           JOIN pg_attribute a
             ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'
            AND c.confdeltype = ANY($2::"char"[])
            AND c.confrelid = $1::regclass
            AND array_length(c.conkey, 1) = 1`,
        [q(table), delTypes],
    );
    return rows.map((r) => ({ table: r.child_table.replace(/^"|"$/g, ""), column: r.child_column }));
}

/** Whether this table's fingerprint compares row contents rather than keys, and so
 *  whether a mismatch can be one that only `rowHashDiff` will explain. */
function hashesRowContent(entry) {
    return HASHES_ROW_CONTENT.has(entry.strategy);
}

/**
 * Columns the SOURCE has and the replica does not, from two content fingerprints.
 * Empty for a key fingerprint, which carries no column list.
 *
 * The asymmetry is deliberate and only goes one way. A column the REPLICA still has and
 * the source has dropped is tolerated — that is what the column list passed to
 * `contentFingerprint` exists for. The reverse cannot be: the replica has nowhere to put
 * the value, so every row reads as different, for one schema reason rather than N data
 * reasons. Callers must say that plainly instead of reporting thousands of drifted rows,
 * and must NOT try to repair it — `upsert` builds its column list from the SOURCE row,
 * so it would name a column the replica lacks and fail on every batch.
 *
 * Seen live on 2026-09-08: a counter still running the previous build reported all 405
 * `UniversalVoucher` and all 35 `Ticket` rows as drifted, because the office had gained
 * `sourceCounterId` and that replica's schema had not caught up yet.
 */
function missingColumns(srcFp, locFp) {
    if (!srcFp || !locFp || !srcFp.columns || !locFp.columns) return [];
    const here = new Set(locFp.columns);
    return srcFp.columns.filter((c) => !here.has(c));
}

module.exports = {
    fingerprint, contentFingerprint, same, keyDiff, rowHashDiff, keyExpression, KEY_SEPARATOR,
    stampColumn, stampExpression,
    referencingNullers,
    referencingCascades, hashesRowContent, missingColumns,
};
