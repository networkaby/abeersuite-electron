"use strict";

/**
 * Which rows of a table this counter has written and NOT yet pushed.
 *
 * Reconciliation reads "present here, absent on the source" as "deleted upstream" and
 * removes the row. That reading is right for a pure downstream replica and wrong for
 * this one, because a counter is also an ORIGIN: it creates rows locally and pushes
 * them later through `_outbox`. Until the push lands, such a row is absent upstream
 * for the opposite reason — the cloud has not seen it yet — and deleting it destroys
 * the only copy. For most tables the outbox payload survives and the row comes back
 * once pushed; for `VoucherSeriesCounter` the allocator re-creates the row from zero
 * first and the till re-issues invoice numbers already printed. So `deleteByKeys`
 * asks this module before it deletes anything.
 *
 * Only PENDING rows are held back (`pushed_at IS NULL AND dead_lettered_at IS NULL`,
 * the same predicate as `_outbox_pending_idx`). A dead-lettered row is one the cloud
 * refused permanently; holding it forever would keep its table from ever verifying,
 * and every till would then pay a full key transfer from Supabase every hour — the
 * egress this project exists to avoid. That row is already shouted about by the status
 * badge, and its payload is recoverable from `_outbox`. A table that can never afford
 * the loss carries `localAuthority` in the registry instead (see pull.js).
 *
 * ── Why the join is on `row_key`, not `row_pk` ─────────────────────────────
 * Both columns identify the row, but `row_pk` joins compound keys with `chr(31)` and
 * `keyExpression` joins them with the four-character sequence `\x1f` (see
 * KEY_SEPARATOR in reconcile.js). They never match, and the mismatch is silent: every
 * compound-keyed table would look unprotected while the guard reported success. So
 * the key is rebuilt here from the typed `row_key` jsonb with the engine's own
 * separator, in SQL, using the same `->>` rendering the trigger itself uses.
 */

const { KEY_SEPARATOR } = require("./reconcile");

/**
 * @returns {Promise<Set<string>>} keys, in `keyExpression` text form, that still sit
 *   unpushed in `_outbox` for this table. Empty on a machine with no outbox at all
 *   (the office, the test harness): nothing to protect there.
 */
async function pendingKeys(local, entry) {
    const exists = await local.query(`SELECT to_regclass('public."_outbox"') IS NOT NULL AS ok`);
    if (!exists.rows[0].ok) return new Set();

    const { rows } = await local.query(
        `SELECT string_agg(o.row_key ->> u.col, $2 ORDER BY u.ord) AS k
           FROM "_outbox" o, unnest($3::text[]) WITH ORDINALITY AS u(col, ord)
          WHERE o.table_name = $1
            AND o.pushed_at IS NULL
            AND o.dead_lettered_at IS NULL
          GROUP BY o.id`,
        [entry.table, KEY_SEPARATOR, entry.pk],
    );
    return new Set(rows.map((r) => r.k));
}

module.exports = { pendingKeys };
