"use strict";

/**
 * Refuses to sync into a replica whose shape no longer matches the source.
 *
 * ── Why this has to exist ────────────────────────────────────────────────────
 * There are no Prisma migrations in this project (schema is applied with
 * `db push`), so there is no migration hash to compare and no version to check.
 * Meanwhile the app artifact and the replica are deployed separately, so they CAN
 * drift: someone pushes a schema change to Supabase, and until the counter's build
 * and replica are updated the two disagree.
 *
 * Drift does not announce itself. A column added upstream simply never arrives, so
 * a report renders with a field permanently blank; a column dropped upstream makes
 * the worker's INSERT fail on one table while every other table keeps succeeding,
 * which reads as "one table is broken" rather than "this replica is the wrong
 * shape". Halting is the honest response: a replica that is knowingly wrong should
 * stop pretending, not keep serving.
 *
 * Compared directly over SQL, both sides, no HTTP hop and no endpoint to secure --
 * the worker already holds a connection to each.
 */

/**
 * Column shape of every base table in `public`, as `table.column -> type`.
 *
 * Deliberately narrow: name, data type, and nullability. Defaults and constraints
 * are excluded because they differ legitimately between a source and a restored
 * replica (sequence ownership in particular) and would produce noise, not signal.
 */
async function columnMap(client) {
    const { rows } = await client.query(
        `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`,
    );
    const map = new Map();
    for (const r of rows) {
        map.set(`${r.table_name}.${r.column_name}`, `${r.data_type}:${r.is_nullable}`);
    }
    return map;
}

/**
 * @returns {Promise<{ ok: boolean, missing: string[], extra: string[], changed: string[], detail: string }>}
 *
 * `ignore` skips tables that legitimately exist on only one side -- `_sync_state`
 * and `_sync_status` are the worker's own bookkeeping and live only on the replica,
 * and `_prisma_migrations` is a leftover on Supabase that is not a model at all.
 */
async function compare(source, local, ignore) {
    const skip = new Set([...(ignore || []), "_sync_state", "_sync_status"]);
    const skipCol = (k) => skip.has(k.split(".")[0]);

    const [src, loc] = await Promise.all([columnMap(source), columnMap(local)]);

    const missing = [];  // upstream has it, replica does not -> data silently absent
    const changed = [];  // both have it, different type -> writes may fail or truncate
    for (const [k, v] of src) {
        if (skipCol(k)) continue;
        if (!loc.has(k)) missing.push(k);
        else if (loc.get(k) !== v) changed.push(`${k} (source ${v}, replica ${loc.get(k)})`);
    }

    const extra = [];    // replica has it, upstream does not -> stale local column
    for (const k of loc.keys()) {
        if (skipCol(k)) continue;
        if (!src.has(k)) extra.push(k);
    }

    const parts = [];
    if (missing.length) parts.push(`${missing.length} column(s) missing locally: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " ..." : ""}`);
    if (changed.length) parts.push(`${changed.length} type change(s): ${changed.slice(0, 5).join("; ")}${changed.length > 5 ? " ..." : ""}`);
    if (extra.length) parts.push(`${extra.length} stale local column(s): ${extra.slice(0, 8).join(", ")}${extra.length > 8 ? " ..." : ""}`);

    return {
        // `extra` alone does not halt: a column dropped upstream leaves a harmless
        // unused column here, and the next reseed clears it. Missing or retyped
        // columns DO halt, because those corrupt what the replica serves.
        ok: missing.length === 0 && changed.length === 0,
        missing,
        extra,
        changed,
        detail: parts.join(" | ") || "in step with source",
    };
}

module.exports = { compare, columnMap };
