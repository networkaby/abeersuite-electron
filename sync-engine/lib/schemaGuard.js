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
 * @returns {Promise<{ ok: boolean, missing: string[], extra: string[], changed: string[], looser: string[], detail: string }>}
 *
 * `ignore` skips tables that legitimately exist on only one side.
 *
 * Every underscore-prefixed table is skipped outright, whichever side it is on. None
 * of them is a model: `_sync_state`/`_sync_status` are this worker's bookkeeping,
 * `_outbox`/`_id_ranges`/`_provision` belong to the counter alone, and
 * `_prisma_migrations` is a leftover on Supabase. Naming them one by one meant the
 * counter-only ones were reported as drift on EVERY cycle -- 19 "stale local
 * column(s)" of pure noise printed next to the one line that mattered. Prisma models
 * are PascalCase, so the prefix cannot swallow a real table.
 */
async function compare(source, local, ignore) {
    const skip = new Set([...(ignore || []), "_sync_state", "_sync_status"]);
    const skipCol = (k) => {
        const table = k.split(".")[0];
        return table.startsWith("_") || skip.has(table);
    };

    const [src, loc] = await Promise.all([columnMap(source), columnMap(local)]);

    const missing = [];  // upstream has it, replica does not -> data silently absent
    const changed = [];  // both have it, incompatible shape -> writes may fail or truncate
    const looser  = [];  // replica permits more than source sends -> harmless, reported only

    // `type:is_nullable`, split on the LAST colon so a type containing one
    // ("timestamp without time zone" does not, but character varying(n) forms
    // could) cannot be mis-parsed.
    const split = (v) => {
        const i = v.lastIndexOf(":");
        return { dataType: v.slice(0, i), nullable: v.slice(i + 1) === "YES" };
    };

    for (const [k, v] of src) {
        if (skipCol(k)) continue;
        if (!loc.has(k)) { missing.push(k); continue; }
        if (loc.get(k) === v) continue;

        const s = split(v);
        const l = split(loc.get(k));

        // A differing DATA TYPE always halts: it truncates or rejects.
        if (s.dataType !== l.dataType) {
            changed.push(`${k} (source ${v}, replica ${loc.get(k)})`);
            continue;
        }

        // NULLABILITY is directional — only one of the two mismatches can lose a
        // row, and treating both as fatal is what made a column's nullability
        // effectively unchangeable:
        //
        //   source nullable, replica NOT NULL -> a NULL the source legitimately
        //       holds CANNOT be inserted here. The replica is stricter than the
        //       truth it copies, so the row is dropped. Still halts.
        //
        //   source NOT NULL, replica nullable -> the replica merely permits
        //       something the source will never send. Every row lands unchanged.
        //       Harmless, so it is reported and does not halt.
        //
        // The asymmetry matters because `resources/local-schema.sql` reaches an
        // EXISTING replica table only through `ADD COLUMN IF NOT EXISTS`, a no-op
        // on a column already present (scripts/gen-local-schema.ts states this
        // limit itself). A server-side SET NOT NULL therefore cannot be mirrored
        // onto an old replica, and under the old equality test every till halted
        // for good on a difference that cannot corrupt anything.
        if (l.nullable) looser.push(`${k} (source NOT NULL, replica nullable)`);
        else changed.push(`${k} (source nullable, replica NOT NULL)`);
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
    if (looser.length) parts.push(`${looser.length} column(s) nullable here, NOT NULL upstream (safe): ${looser.slice(0, 5).join("; ")}${looser.length > 5 ? " ..." : ""}`);

    return {
        // `extra` alone does not halt: a column dropped upstream leaves a harmless
        // unused column here, and the next reseed clears it. Nor does `looser`: a
        // replica that permits a NULL the source never sends still stores every
        // row faithfully. Missing or retyped columns DO halt, because those
        // corrupt what the replica serves.
        ok: missing.length === 0 && changed.length === 0,
        missing,
        extra,
        changed,
        looser,
        detail: parts.join(" | ") || "in step with source",
    };
}

module.exports = { compare, columnMap };
