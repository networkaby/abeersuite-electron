"use strict";

/**
 * Runs exactly one sync cycle and exits.
 *
 * This is the whole engine, callable by hand: the long-running service (index.js,
 * not yet written) will be a scheduler around this and nothing more. Keeping the
 * cycle runnable on its own is what makes it testable against a real replica
 * instead of only in theory.
 *
 *   node sync-once.js --dry-run     report what would move, write nothing
 *   node sync-once.js               sync
 *   node sync-once.js --only Ticket,Account   sync those models (and their children)
 *   node sync-once.js --verify Coupon   reconcile these models THIS cycle, hourly
 *                                       schedule or not — the office reported a hard
 *                                       delete on them (index.js passes it). Their
 *                                       cascade children come along.
 *   node sync-once.js --reason signal   what woke this cycle (index.js passes it);
 *                                       signal|queued|relay may trust a recent schema
 *                                       check; relay also skips the reconcile pass
 *   node sync-once.js --serve           stay alive, run a cycle per IPC request on warm
 *                                       connections (how index.js runs it; see serve())
 *
 * Config: config.json beside this file (see config.example.json).
 */

const fs = require("node:fs");
const path = require("node:path");
const { pool, canSuspendForeignKeys, q } = require("./lib/db");
const registryLib = require("./lib/registry");
const state = require("./lib/state");
const {
    pullWatermark, pullFull, pullChildren, pullByKeys, refreshByKeys, recheckBehindCursor, deleteByKeys,
} = require("./lib/pull");
const totals = require("./lib/rebuildTotals");
const reconcile = require("./lib/reconcile");
const schemaGuard = require("./lib/schemaGuard");
const status = require("./lib/status");
const { configPath } = require("./lib/configPath");

/**
 * One cycle's options, from command-line style arguments — `process.argv` when run by
 * hand, the `run` message's `args` in `--serve` mode.
 *
 *   DRY         report only, write nothing
 *   ONLY        model names to sync, or null for every table (children come along)
 *   VERIFY_NOW  models to reconcile this cycle regardless of when they were last proven
 *   REASON      startup | interval | signal | queued | relay | manual (default).
 *               `relay` is the app's own targeted pull after a write it relayed to the
 *               office (lib/localSignal.js) — it holds a user's response, so it is kept
 *               as short as possible.
 */
function parseArgs(args) {
    const list = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 && args[i + 1]
            ? args[i + 1].split(",").map((s) => s.trim()).filter(Boolean)
            : null;
    };
    const reasonIdx = args.indexOf("--reason");
    return {
        DRY: args.includes("--dry-run"),
        ONLY: list("--only"),
        VERIFY_NOW: list("--verify") || [],
        REASON: reasonIdx >= 0 ? args[reasonIdx + 1] : "manual",
    };
}

/**
 * Tables in flight at once, per pass.
 *
 * An idle cycle is ~80 small Supabase round-trips, and run one after another on a
 * single connection they cost ~0.6 s of pure latency. The tables inside a pass are
 * independent of each other (foreign keys are suspended per transaction, and
 * `_sync_state` is one row per table), so nothing but the connection count stops them
 * overlapping. Four is enough to hide the latency without leaning on the pooler.
 */
const CONCURRENCY = 4;

/**
 * How long a passed schema check stays trusted for a cycle woken by a signal.
 *
 * Drift is a deploy event, and the interval cycle (see index.js, same 10 minutes)
 * always re-checks. Re-running two `information_schema` scans on every signal — one
 * of them against Supabase — bought nothing between those checks.
 */
const SCHEMA_TRUST_MS = 10 * 60 * 1000;

/** Run `fn` over `items`, at most `limit` at a time, in order of start. */
async function runLimited(items, limit, fn) {
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    });
    await Promise.all(lanes);
}

/** Rows per page. Bounds both memory and the size of one transaction. */
const PAGE = 2000;

/**
 * Pages one table may drain in a single cycle. A stop, not a target: without it a
 * table whose cursor is somehow not advancing would spin forever inside one cycle
 * and starve every table after it.
 */
const MAX_PAGES = 50;

/**
 * How stale a table's equality proof may get before it is re-checked.
 *
 * `watermark`, `append` AND `child` tables are reconciled. `full` is exact by
 * construction (replaced wholesale). `child` was excluded on the argument that it is
 * exact for any parent that moved — true, but a child row inserted WITHOUT touching
 * its parent's `updatedAt` never moves the parent, so it is never pulled, and nothing
 * else looks at that table again. Found on a real replica (2026-09-03): 26
 * `LoyaltyLedger` and 24 `LoyaltyLot` rows in Supabase, 0 here, every cycle "0 failed".
 * The fingerprint is two numbers per side, so proving a child table costs the same as
 * any other.
 */
const VERIFY_INTERVAL_MS = 60 * 60 * 1000;
const VERIFY_STRATEGIES = ["watermark", "append", "child"];

/** Tables reconciled per cycle. Spreads the cost instead of a periodic stall. */
const VERIFY_BUDGET = 12;

function loadConfig() {
    const p = configPath();
    if (!fs.existsSync(p)) {
        console.error(`No config.json at ${p}. Copy config.example.json and fill it in.`);
        process.exit(2);
    }
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const k of ["sourceUrl", "localUrl"]) {
        if (!cfg[k]) {
            console.error(`config.json is missing "${k}".`);
            process.exit(2);
        }
    }
    return cfg;
}

/**
 * After parent rows were deleted here, bring every row that REFERENCED them back in
 * step with the source.
 *
 * Deleting the parent on the source fires that FK's ON DELETE SET NULL and rewrites
 * the child row there. The same delete here does not, because everything is applied
 * under `session_replication_role = replica` so rows can land out of dependency order
 * (lib/db.js). The child is then left pointing at a key that no longer exists, and
 * nothing ever repairs it: its `updatedAt` did not move (the source's change was made
 * by PostgreSQL, not by Prisma), so no delta pull looks at it again, and the
 * reconcile's hash compares keys only, which still match on both sides.
 *
 * So we re-read those children from the source and let its answer stand. Every delete
 * reaching this replica comes through `deleteByKeys` in pass 3, which is why this one
 * call site is enough to cover all 95 of the schema's SET NULL constraints.
 *
 * Costs nothing on an ordinary cycle: only reached when a delete actually happened.
 */
/**
 * `models` plus every replicated table that loses rows when one of them does: registry
 * children (`strategy: child`, which ride their parent) and any table whose foreign key
 * is `ON DELETE CASCADE` onto one of them, followed transitively. The source removed
 * those rows itself; this replica applies deletes with FK actions suspended and would
 * keep them until that table's own hourly turn.
 */
async function withCascadeChildren(local, tables, models) {
    const out = new Set(models);
    const byTable = new Map(Object.entries(tables).map(([m, e]) => [e.table, m]));
    const queue = [...models];
    while (queue.length) {
        const model = queue.shift();
        for (const [m, e] of Object.entries(tables)) {
            if (e.strategy === "child" && e.parent === model && !out.has(m)) { out.add(m); queue.push(m); }
        }
        for (const ref of await reconcile.referencingCascades(local, tables[model].table)) {
            const m = byTable.get(ref.table);
            if (m && !out.has(m)) { out.add(m); queue.push(m); }
        }
    }
    return out;
}

async function repairReferencing(source, local, tables, fkCache, entry, deletedKeys, changedModels) {
    // `deletedKeys` are keyExpression text. Matching them against a single-column FK
    // is only meaningful when the parent key is itself one column; referencingNullers
    // already returns single-column foreign keys only.
    if (entry.pk.length !== 1) return 0;

    if (!fkCache.byTable) {
        fkCache.byTable = new Map(Object.entries(tables).map(([m, e]) => [e.table, m]));
    }
    if (!fkCache.nullers.has(entry.table)) {
        fkCache.nullers.set(entry.table, await reconcile.referencingNullers(local, entry.table));
    }

    let pulled = 0;
    for (const ref of fkCache.nullers.get(entry.table)) {
        const childModel = fkCache.byTable.get(ref.table);
        if (!childModel) continue; // not replicated here, so nothing to keep in step
        const childEntry = tables[childModel];

        const { rows } = await local.query(
            `SELECT ${reconcile.keyExpression(childEntry)} AS k
               FROM ${q(ref.table)}
              WHERE ${q(ref.column)}::text = ANY($1)`,
            [deletedKeys],
        );
        if (rows.length === 0) continue;

        const n = await pullByKeys(source, local, childEntry, rows.map((r) => r.k));
        if (n > 0) {
            changedModels.add(childModel);
            pulled += n;
            console.log(`  ${childModel.padEnd(28)} fk-repair ${n} (after ${entry.table} delete)`);
        }
    }
    return pulled;
}

/**
 * Run one cycle and return its exit code (0 ok, 1 a table failed). The fatal states —
 * no config (2), missing grants (3), schema drift (4) — still exit the process.
 *
 * `pools` is `{ source, local }` held by `--serve` mode across cycles; without it the
 * cycle opens its own and closes them when done. `hooks.onReading()` fires as the first
 * table is read from the source; `hooks.onApplied(info)` fires with the applied line.
 */
async function main(opts, cfg, pools = null, hooks = {}) {
    const { DRY, ONLY, VERIFY_NOW, REASON } = opts;
    const registryPath = cfg.registryPath
        ? path.resolve(__dirname, cfg.registryPath)
        : registryLib.defaultRegistryPath();

    if (!fs.existsSync(registryPath)) {
        console.error(`No sync registry at ${registryPath}.`);
        console.error(`It ships with the app artifact; set "registryPath" in config.json.`);
        process.exit(2);
    }

    const { tables, ignore } = registryLib.load(registryPath);
    const order = registryLib.syncOrder(tables);
    if (ONLY) {
        const unknown = ONLY.filter((m) => !tables[m]);
        if (unknown.length) console.log(`--only: ignoring unknown model(s) ${unknown.join(", ")}`);
    }
    if (VERIFY_NOW.length) {
        const unknown = VERIFY_NOW.filter((m) => !tables[m]);
        if (unknown.length) console.log(`--verify: ignoring unknown model(s) ${unknown.join(", ")}`);
    }

    // One long-lived client per side for the bookkeeping (guard, state, reconcile,
    // status), plus one per lane for the table passes below.
    const ownPools = !pools;
    const sourcePool = pools ? pools.source : pool(cfg.sourceUrl, CONCURRENCY + 1);
    const localPool = pools ? pools.local : pool(cfg.localUrl, CONCURRENCY + 1);
    const source = await sourcePool.connect();
    const local = await localPool.connect();

    const t0 = Date.now();
    let pulledTotal = 0;
    /** Models this cycle actually wrote rows into — the payload of the "applied" line
     *  below. A model that pulled nothing is deliberately absent: the whole point is to
     *  leave screens alone when a cycle changed nothing they could see. */
    const changedModels = new Set();
    /** Per-cycle memo for repairReferencing: FK introspection and table->model. */
    const fkCache = { nullers: new Map(), byTable: null };
    let failed = 0;
    let skipped = 0;
    let verified = 0;
    let repaired = 0;
    /** Totals re-summed in pass 4 — possibly a killed cycle's, with no row pulled now. */
    let rebuilt = 0;

    try {
        try {
            await state.ensure(local);
        } catch (e) {
            if (e && e.code === "42501") {
                console.error("");
                console.error("The sync role cannot create its bookkeeping table (_sync_state):");
                console.error(`  ${e.message}`);
                console.error("");
                console.error("Fix (as the local superuser):");
                console.error('  psql "postgresql://postgres:PW@localhost:5432/smx" -f scripts/retrofit-grants.sql');
                process.exit(3);
            }
            throw e;
        }

        // Checked once, up front: without the grant the first 'full' table dies on a
        // foreign key, which reads like corrupt data and is not.
        if (!(await canSuspendForeignKeys(local))) {
            console.error("");
            console.error("The sync role cannot set session_replication_role, so foreign keys");
            console.error("cannot be suspended and a full-table replace will fail on a constraint.");
            console.error("Fix (as the local superuser):");
            console.error("  psql \"postgresql://postgres:PW@localhost:5432/smx\" -f scripts/retrofit-grants.sql");
            process.exit(3);
        }

        await status.ensure(local);
        await totals.ensure(local);

        // Checked before anything is written: syncing into a replica of the wrong
        // shape produces rows that are quietly incomplete rather than an error.
        //
        // A signal-woken cycle may reuse the verdict of a recent full check instead:
        // startup, interval and retry cycles always compare, so drift is still caught
        // within the interval, and a missing or failed status row always compares.
        let schema = null;
        if (REASON === "signal" || REASON === "queued" || REASON === "relay") {
            const last = await status.read(local).catch(() => null);
            const age = last && last.last_cycle_at ? Date.now() - new Date(last.last_cycle_at).getTime() : Infinity;
            if (last && last.schema_ok && age < SCHEMA_TRUST_MS) {
                schema = { ok: true, detail: last.schema_detail || "in step with source" };
            }
        }
        if (!schema) schema = await schemaGuard.compare(source, local, ignore);
        if (!schema.ok) {
            console.error("");
            console.error("SCHEMA DRIFT - refusing to sync.");
            console.error(`  ${schema.detail}`);
            console.error("");
            console.error("The replica no longer matches the source. Syncing now would write");
            console.error("rows that are silently incomplete. Update the counter's app artifact");
            console.error("and re-run the schema push, or reseed the replica.");
            // Report the REAL sync counts, not zero. Claiming "113 of 113 never
            // synced" alongside a drift message sends the reader after a second,
            // non-existent problem; the tables are fine, the shape is not.
            const known = await state.readAll(local).catch(() => new Map());
            await status.publish(local, {
                schema,
                totalTables: Object.keys(tables).length,
                syncedTables: [...known.values()].filter((r) => r.last_ok_at).length,
                worstLagSec: null,
            });
            process.exit(4);
        }

        const prior = await state.readAll(local);
        /** model -> ids written this cycle, for children to filter on. */
        const moved = new Map();

        // A listed model brings its whole subtree: TicketOrderLine rides TicketOrder
        // rides Ticket, and a targeted cycle that stopped one level down would answer
        // "applied" with the lines still missing.
        const want = (model) => {
            if (!ONLY) return true;
            for (let m = model; m; m = tables[m] && tables[m].parent) {
                if (ONLY.includes(m)) return true;
            }
            return false;
        };

        /**
         * A table this build knows about that the OFFICE has not deployed yet.
         *
         * The release order in AGENTS.md sends the counter build out BEFORE the deploy
         * that carries its migration — deliberately, because a source ahead of a
         * replica halts every table on the till. But that same order means a till can
         * boot holding a registry entry for a table Supabase does not have yet, and
         * "never synced" is what the readiness gate counts: one absent table and the
         * whole counter sits on "Preparing this counter" until the deploy lands. A
         * feature nobody is using yet would stop the billing that pays for the shop.
         *
         * So: `42P01` (undefined_table) FROM THE SOURCE, on a table that has never
         * synced even once, is read as "not deployed yet". It is recorded as a pass
         * with no rows — there are none to have — and the till carries on.
         *
         * Narrow on purpose. A table that HAS synced before and then disappears is
         * real drift and still fails, loudly, every cycle: that is a table being
         * dropped under a running till, which is not the same event at all.
         */
        const notDeployedYet = async (err, entry, local) => {
            if (!err || err.code !== "42P01") return false;
            // The test is what this replica would LOSE, not what it has already
            // recorded. "Has it ever synced" looked right and is not: the tolerated
            // pass itself stamps last_ok_at, so from the next cycle onwards the same
            // table would fail again and the till would brick anyway — one cycle
            // later, which is worse than never working.
            //
            // Empty here and gone there is a table that has never carried a row on
            // this counter: nothing to lose, so wait. Rows here and gone there is a
            // table being dropped under a running till, which is real drift and still
            // fails loudly on every cycle.
            try {
                const { rows } = await local.query(`SELECT 1 FROM "${entry.table}" LIMIT 1`);
                return rows.length === 0;
            } catch {
                return false;   // Cannot even ask — treat it as the failure it is.
            }
        };

        /**
         * Run one table on its own pair of connections. Lanes overlap; the bookkeeping
         * (`moved`, counters, `changedModels`) is plain JS state touched between awaits,
         * which is safe on one thread.
         */
        const withLane = async (fn) => {
            const src = await sourcePool.connect();
            const loc = await localPool.connect();
            try {
                await fn(src, loc);
            } finally {
                src.release();
                loc.release();
            }
        };

        // From here on the source is read table by table: a change committed before this
        // moment is seen by this cycle, so a signal for it need not queue another (index.js).
        if (hooks.onReading) hooks.onReading();

        /**
         * Parent watermarks not yet written, model -> { entry, watermark, watermarkId }.
         *
         * Children ride their parent: pass 2 pulls only the children of parent rows that
         * pass 1 wrote THIS cycle. So a parent's watermark may not move until its children
         * are in. Written straight away, a cycle killed between the two passes (a targeted
         * pull steps it aside, the app quits) or a child pull that fails leaves the parent
         * behind the watermark with no children — and no later cycle asks for them, since
         * the parent never moves again. That is how an upload's header reached the till on
         * 19 Oct 2026 with its three statement lines missing; VoucherGlLine under
         * UniversalVoucher has the same shape. Held back, the next cycle re-pulls the
         * parent rows (an upsert, harmless) and their children come with them.
         *
         * A `full` parent has no watermark; it is marked `children_pending` before it is
         * replaced and that mark is cleared here, so the next cycle re-pulls it even
         * though its fingerprint already matches.
         */
        const held = new Map();
        const parentsInCycle = new Set(order.children.filter(want).map((m) => tables[m].parent));
        /** Pass-1 models whose subtree had a child pull fail this cycle. */
        const childFailedUnder = new Set();
        const rootOf = (model) => {
            let m = model;
            while (tables[m] && tables[m].strategy === "child") m = tables[m].parent;
            return m;
        };

        // Pass 1: tables that stand on their own, CONCURRENCY at a time.
        await runLimited(order.independent.filter(want), CONCURRENCY, (model) => withLane(async (source, local) => {
            const entry = tables[model];
            try {
                let res;
                if (entry.strategy === "full") {
                    // A 'full' table is replaced wholesale, so re-pulling it every
                    // cycle would re-read reference data from Supabase forever. Two
                    // numbers on the wire decide whether that is necessary at all.
                    // The hash covers row CONTENT (reconcile.js): an edit in place — a
                    // released counter, a renamed department — is the only signal a
                    // table without a watermark can give. Source first: its column
                    // list is what the local side hashes against.
                    const srcFp = await reconcile.fingerprint(source, entry);
                    const localFp = await reconcile.fingerprint(local, entry, srcFp.columns || []);
                    // A parent whose children never arrived is pulled again, whatever
                    // its fingerprint says (state.js `children_pending`).
                    const pending = parentsInCycle.has(model) && prior.get(entry.n)?.children_pending === true;
                    if (pending) console.log(`  ${model.padEnd(28)} children pending from an earlier cycle - re-pulling`);
                    if (reconcile.same(srcFp, localFp) && !pending) {
                        skipped++;
                        // Still record the pass so every table has a freshness stamp.
                        if (!DRY) await state.recordSuccess(local, entry, model, null);
                        moved.set(model, []);
                        return;
                    }
                    if (!DRY && parentsInCycle.has(model)) await state.markChildrenPending(local, entry, model);
                    res = DRY ? { pulled: -1, ids: [] } : await pullFull(source, local, entry);
                } else {
                    // Not `prior.watermark` directly: a stored high-water mark is only
                    // comparable against the column it was read from, and that column
                    // changes when a model gains @updatedAt. `cursorFor` drops the
                    // cursor in that case so the table re-drains once, and says so.
                    const resume = state.cursorFor(prior.get(entry.n), entry);
                    if (resume.reason) console.log(`  ${model.padEnd(28)} ${resume.reason}`);
                    const since = resume.since;
                    if (DRY) {
                        const where = since ? `WHERE ${JSON.stringify(entry.column)} > $1` : "";
                        const { rows } = await source.query(
                            `SELECT count(*)::int AS n FROM "${entry.table}" ${where}`,
                            since ? [since] : [],
                        );
                        res = { pulled: rows[0].n, ids: [] };
                    } else {
                        // Drain the table rather than leaving a backlog for the next
                        // tick: a counter that has been offline can be many pages
                        // behind, and stopping after one page would mean it never
                        // catches up while changes keep arriving.
                        //
                        // First, rows that committed after the last cycle had already
                        // passed their stamp: they sit behind the cursor, where the drain
                        // never looks (pull.js recheckBehindCursor). Not on a relay cycle,
                        // which holds a cashier's response; not on a cursor reset, which
                        // re-drains everything anyway.
                        const late = REASON === "relay" || resume.reason != null
                            ? { pulled: 0, ids: [] }
                            : await recheckBehindCursor(source, local, entry, since, resume.sinceId);
                        if (late.pulled > 0) {
                            console.log(`  ${model.padEnd(28)} late      ${late.pulled} (committed behind the cursor)`);
                        }
                        res = { pulled: late.pulled, watermark: null, watermarkId: null, ids: [...late.ids], more: true };
                        let cursor = since;
                        let cursorId = resume.sinceId;
                        let pages = 0;
                        while (res.more && pages < MAX_PAGES) {
                            const page = await pullWatermark(source, local, entry, cursor, cursorId, PAGE, resume.reason != null);
                            if (page.pulled === 0) break;
                            res.pulled += page.pulled;
                            res.ids.push(...page.ids);
                            res.watermark = page.watermark;
                            res.watermarkId = page.watermarkId;
                            res.more = page.more;
                            cursor = page.watermark;
                            cursorId = page.watermarkId;
                            pages++;
                        }
                    }
                }
                moved.set(model, res.ids);
                if (res.pulled !== 0) changedModels.add(model);
                pulledTotal += Math.max(res.pulled, 0);
                // A parent's watermark waits for its children (see `held`).
                if (!DRY && parentsInCycle.has(model) && (res.watermark != null || entry.strategy === "full")) {
                    held.set(model, { entry, watermark: res.watermark, watermarkId: res.watermarkId });
                } else if (!DRY) {
                    await state.recordSuccess(local, entry, model, res.watermark, res.watermarkId);
                }
                if (res.pulled !== 0) {
                    console.log(`  ${model.padEnd(28)} ${entry.strategy.padEnd(9)} ${res.pulled === -1 ? "(full)" : res.pulled}`);
                }
            } catch (e) {
                if (await notDeployedYet(e, entry, local)) {
                    console.log(`  ${model.padEnd(28)} not on the source yet - waiting for the deploy`);
                    moved.set(model, []);
                    if (!DRY) await state.recordSuccess(local, entry, model, null).catch(() => {});
                    return;
                }
                failed++;
                console.error(`  ${model.padEnd(28)} FAILED: ${e.message}`);
                if (!DRY) await state.recordFailure(local, entry, model, e).catch(() => {});
            }
        }));

        // Pass 2: children, shallowest first, so a parent's rewritten ids are already
        // known by the time its own children ask which parents moved. Each depth runs
        // CONCURRENCY-wide; depths run one after another, because a depth-2 child
        // filters on ids its depth-1 parent has only just finished writing.
        const byDepth = new Map();
        for (const model of order.children) {
            if (!want(model)) continue;
            const d = registryLib.depthOf(model, tables, new Set());
            if (!byDepth.has(d)) byDepth.set(d, []);
            byDepth.get(d).push(model);
        }
        for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
            await runLimited(byDepth.get(depth), CONCURRENCY, (model) => withLane(async (source, local) => {
                const entry = tables[model];
                const parentIds = moved.get(entry.parent) || [];
                if (parentIds.length === 0) {
                    moved.set(model, []);
                    // Record the pass anyway. Without this a child whose parent did not
                    // move has NO row in _sync_state, and "never synced" becomes
                    // indistinguishable from "nothing to do" - which is exactly the
                    // question the replicaReady gate has to answer.
                    if (!DRY) await state.recordSuccess(local, entry, model, null).catch(() => {});
                    return;
                }
                try {
                    const res = DRY
                        ? { pulled: parentIds.length, ids: [] }
                        : await pullChildren(source, local, entry, parentIds);
                    moved.set(model, res.ids);
                    if (res.pulled !== 0) changedModels.add(model);
                    pulledTotal += res.pulled;
                    if (!DRY) await state.recordSuccess(local, entry, model, null);
                    if (res.pulled !== 0) {
                        console.log(`  ${model.padEnd(28)} child     ${res.pulled} (for ${parentIds.length} parent(s))`);
                    }
                } catch (e) {
                    if (await notDeployedYet(e, entry, local)) {
                        console.log(`  ${model.padEnd(28)} not on the source yet - waiting for the deploy`);
                        moved.set(model, []);
                        if (!DRY) await state.recordSuccess(local, entry, model, null).catch(() => {});
                        return;
                    }
                    failed++;
                    childFailedUnder.add(rootOf(model));
                    console.error(`  ${model.padEnd(28)} FAILED: ${e.message}`);
                    if (!DRY) await state.recordFailure(local, entry, model, e).catch(() => {});
                }
            }));
        }

        // Every child is in: the held parent watermarks can move now — except under a
        // failed child, where the parent rows re-pull next cycle and bring it along.
        for (const [model, h] of held) {
            if (childFailedUnder.has(model)) {
                console.log(`  ${model.padEnd(28)} held - a child pull failed; re-pulling next cycle`);
                continue;
            }
            await state.recordSuccess(local, h.entry, model, h.watermark, h.watermarkId);
        }
        // ---- Pass 3: reconcile a few tables against the source ----------------
        //
        // A watermark reports that a row CHANGED; it can never report that a row is
        // GONE. Without this pass a deleted invoice would sit on the counter forever,
        // and a row — or an edit — whose timestamp is behind our cursor could never be
        // recovered. Both directions are repaired, and missed edits too.
        //
        // Not in a relay cycle: that one holds a cashier's response, and the interval
        // and signal cycles verify the same tables on the same schedule regardless.
        if (!DRY && REASON !== "relay") {
            const nowMs = Date.now();
            // The office said these lost rows. They go first, outside the hourly schedule
            // and outside the budget: a delete is exactly what a watermark cannot see, and
            // waiting for the table's turn is how eight deleted coupons sat on a counter.
            // A cascade child loses its rows on the source too, but here the parent is
            // deleted with FK actions suspended, so the child is reconciled as well.
            const forced = await withCascadeChildren(local, tables, VERIFY_NOW.filter((m) => tables[m]));
            const forcedDue = [...order.independent, ...order.children]
                .filter((m) => forced.has(m) && VERIFY_STRATEGIES.includes(tables[m].strategy));
            const due = [...order.independent, ...order.children]
                .filter((m) => want(m) && !forced.has(m))
                .filter((m) => VERIFY_STRATEGIES.includes(tables[m].strategy))
                .filter((m) => {
                    const st = prior.get(tables[m].n);
                    const last = st && st.last_verify_at ? new Date(st.last_verify_at).getTime() : 0;
                    return nowMs - last >= VERIFY_INTERVAL_MS;
                })
                // Longest-unverified first, so nothing can be starved indefinitely.
                .sort((a, b) => {
                    const av = prior.get(tables[a].n);
                    const bv = prior.get(tables[b].n);
                    const at = av && av.last_verify_at ? new Date(av.last_verify_at).getTime() : 0;
                    const bt = bv && bv.last_verify_at ? new Date(bv.last_verify_at).getTime() : 0;
                    return at - bt;
                })
                .slice(0, VERIFY_BUDGET);

            for (const model of [...forcedDue, ...due]) {
                const entry = tables[model];
                try {
                    // Source FIRST, not in parallel: a row-content fingerprint (full and
                    // child tables — see reconcile.js) has the replica hash only the
                    // columns the source still has, so it needs that list back before it
                    // can run. Without it, a column the replica carries and the source has
                    // dropped would read as a permanent difference. One extra round trip
                    // on at most VERIFY_BUDGET tables a cycle.
                    const srcFp = await reconcile.fingerprint(source, entry);
                    const locFp = await reconcile.fingerprint(local, entry, srcFp.columns || []);
                    verified++;
                    if (reconcile.same(srcFp, locFp)) {
                        await state.recordVerified(local, entry, srcFp.count, srcFp.checksum);
                        continue;
                    }
                    // Only now pay to move keys.
                    const diff = await reconcile.keyDiff(source, local, entry);
                    // Not every onlyLocal key is an upstream delete: a row this counter
                    // wrote and has not pushed yet looks identical, and deleteByKeys
                    // holds those back (lib/outboxGuard.js). Say so, because a table
                    // with held rows stays unverified until the push lands, and a log
                    // reading "-0" every hour with no reason would look like a fault.
                    const { removed, deletedKeys, heldKeys } = await deleteByKeys(local, entry, diff.onlyLocal);
                    // An edit the delta pull missed: the same key on both sides, last
                    // changed at a different time (reconcile.js, job 3). The source's copy
                    // wins — except a row still in _outbox, which is this counter's own
                    // newer edit on its way up, and is held for the same reason.
                    const { refreshed: restamped, heldKeys: heldEdits } =
                        await refreshByKeys(source, local, entry, diff.stale);
                    const held = heldKeys.length + heldEdits.length;
                    if (held > 0) {
                        console.log(`  ${model.padEnd(28)} held      ${held} local row(s) not yet pushed`);
                    }
                    const added = await pullByKeys(source, local, entry, diff.onlySource);
                    repaired += removed + added + restamped;
                    // The source's ON DELETE SET NULL rewrote the rows that referenced
                    // what we just deleted; ours did not, because FK actions are
                    // suspended while applying. Re-read them. See repairReferencing.
                    if (removed > 0) {
                        repaired += await repairReferencing(
                            source, local, tables, fkCache, entry, deletedKeys, changedModels,
                        );
                    }
                    // A content fingerprint can disagree while the KEYS match perfectly —
                    // that is the whole reason full and child tables hash the row. keyDiff
                    // has nothing to say about those, so without this the repair would move
                    // nothing, the re-fingerprint would still differ, and the table would
                    // never be marked verified: a loop that makes no progress and logs
                    // "still differs after repair" every hour.
                    // ...but not while the replica is missing a column the source has. Then
                    // every row reads as different for one schema reason, and `upsert`
                    // names the source's columns, so the repair would fail on every batch.
                    // schemaGuard should have halted the worker long before this; this is
                    // the cheap second lock on the same door.
                    const behind = reconcile.missingColumns(srcFp, locFp);
                    const refreshed = reconcile.hashesRowContent(entry) && behind.length === 0
                        ? await pullByKeys(source, local, entry,
                            await reconcile.rowHashDiff(source, local, entry, srcFp.columns || []))
                        : 0;
                    if (behind.length) {
                        console.log(`  ${model.padEnd(28)} schema behind: missing ${behind.join(", ")}`);
                    }
                    repaired += refreshed;
                    // A repair changes what this replica serves just as a pull does, so
                    // the screens must hear about it (see __SYNC_APPLIED__ below).
                    if (removed + added + refreshed + restamped > 0) changedModels.add(model);
                    console.log(
                        `  ${model.padEnd(28)} repair    -${removed} +${added} ~${refreshed + restamped}`,
                    );
                    const after = await reconcile.fingerprint(local, entry, srcFp.columns || []);
                    if (reconcile.same(srcFp, after)) {
                        await state.recordVerified(local, entry, after.count, after.checksum);
                    } else {
                        // Repaired but still not equal: the source moved underneath us,
                        // or something is wrong. Leave it unverified so the next cycle
                        // looks again rather than recording a proof we do not have.
                        console.log(`  ${model.padEnd(28)} still differs after repair`);
                    }
                } catch (e) {
                    // Same story as the pulls above: nothing to reconcile against a
                    // table that is not there yet, and it must not count as a failure.
                    if (await notDeployedYet(e, entry, local)) continue;
                    failed++;
                    console.error(`  ${model.padEnd(28)} VERIFY FAILED: ${e.message}`);
                }
            }
        }
        // ---- Pass 4: re-sum the running totals this cycle's ledger rows touched -
        //
        // Pulled rows leave Account.balance / stock / GiftCard.balance alone (see
        // rebuildTotals.js); this is where the replica's own copies catch up. Runs
        // after every pass, including reconcile repairs, so a repaired GL line is
        // counted the same cycle it arrives — and it also finishes what a cycle killed
        // before this point left in `_sync_dirty`.
        if (!DRY) {
            try {
                const changed = await totals.rebuildTouched(local, console.log);
                rebuilt = changed;
                // A changed total changes what a balance screen shows, exactly as a
                // pulled row does — and only the models a screen can name are useful.
                if (changed > 0) {
                    changedModels.add("Account");
                    changedModels.add("InvProduct");
                    changedModels.add("GiftCard");
                }
            } catch (e) {
                failed++;
                console.error(`  totals                       REBUILD FAILED: ${e.message}`);
            }
        }

        // ---- Pass 5: step the id sequences over the rows this cycle pulled ----
        //
        // Pulled rows arrive WITH their id, and Postgres does not advance a sequence
        // for an id supplied by hand. After a reinstall the pull brings this counter's
        // own earlier rows back into its block while every sequence still sits at the
        // block start — the next local insert then fails on the id unique constraint.
        // `_apply_id_range` (resources/local-schema.sql) restarts each sequence above
        // the highest id already present inside this counter's block, and only that
        // block, so it can never wander into another counter's range. No-op when
        // nothing needs moving; skipped on a replica that has no range yet.
        if (!DRY) {
            try {
                const { rows } = await local.query(`SELECT block_start FROM "_id_ranges" LIMIT 1`);
                const blockStart = rows[0]?.block_start;
                if (blockStart != null) {
                    const { rows: r } = await local.query(`SELECT _apply_id_range($1) AS moved`, [blockStart]);
                    if (r[0]?.moved > 0) console.log(`  id ranges                    stepped ${r[0].moved} sequence(s) past pulled rows`);
                }
            } catch (e) {
                failed++;
                console.error(`  id ranges                    APPLY FAILED: ${e.message}`);
            }
        }

        // ---- Publish readiness ------------------------------------------------
        if (!DRY) {
            const after = await state.readAll(local);
            const total = Object.keys(tables).length;
            const synced = [...after.values()].filter((r) => r.last_ok_at).length;
            const lags = [...after.values()]
                .filter((r) => r.last_ok_at)
                .map((r) => Math.round((Date.now() - new Date(r.last_ok_at).getTime()) / 1000));
            const worst = lags.length ? Math.max(...lags) : null;

            const { ready, reasons } = await status.publish(local, {
                schema,
                totalTables: total,
                syncedTables: synced,
                worstLagSec: worst,
            });
            console.log("");
            console.log(ready
                ? `replica READY - ${synced}/${total} tables, schema in step`
                : `replica NOT ready - ${reasons.join("; ")}`);
        }
    } finally {
        source.release();
        local.release();
        if (ownPools) {
            await sourcePool.end();
            await localPool.end();
        }
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log("");
    console.log(
        `${DRY ? "[dry run] " : ""}${pulledTotal} row(s) in ${secs}s, ` +
        `${skipped} full table(s) unchanged (not transferred), ${failed} failed.`,
    );
    if (verified || repaired) {
        console.log(`${verified} table(s) verified against source, ${repaired} row(s) repaired.`);
    }

    // The applied report. Made AFTER every write has committed, so a reader that acts on
    // it is guaranteed the rows are already queryable -- which is the entire point: the
    // app's screens used to re-read the replica in parallel with this process and
    // routinely beat it there. Silent when nothing moved, so a no-op cycle wakes nobody.
    // Rows repaired by the reconcile pass count: they change what the replica serves
    // exactly as a pull does.
    if (!DRY && pulledTotal + repaired + rebuilt > 0) {
        const info = { rows: pulledTotal + repaired + rebuilt, models: [...changedModels] };
        console.log(`__SYNC_APPLIED__ ${JSON.stringify(info)}`);
        if (hooks.onApplied) hooks.onApplied(info);
    }
    return failed === 0 ? 0 : 1;
}

/**
 * `--serve`: stay alive and run a cycle per `run` message from index.js, on ONE pair of
 * pools held across cycles.
 *
 * A process per cycle opened up to five fresh Supabase connections every time, and a
 * busy till runs well over a hundred cycles an hour, mostly finding nothing. Each
 * connection is logged twice by the pooler (authenticated, terminated) at ~1 KB a line,
 * which is what pushed the project past the free plan's log-ingestion allowance
 * (2026-10-12: ~64k pooler lines a day). Warm connections cost none of that.
 *
 * Still a child process, so index.js keeps everything the separation bought: a stuck
 * cycle is killed, a pre-empted one is killed. Only a clean cycle keeps the process —
 * any failure exits, so a broken connection never carries into the next cycle — and
 * index.js retires it on age as well.
 *
 *   in:  { type: "run", args }   { type: "quit" }
 *   out: { type: "reading" }     { type: "applied", rows, models }   { type: "done", code: 0 }
 */
async function serve() {
    const cfg = loadConfig();
    // No idle timeout: the point is that the connections outlive the cycle. index.js
    // retires this process on age, which closes them.
    const pools = {
        source: pool(cfg.sourceUrl, CONCURRENCY + 1, { idleTimeoutMillis: 0 }),
        local: pool(cfg.localUrl, CONCURRENCY + 1, { idleTimeoutMillis: 0 }),
    };
    const send = (msg) => { try { process.send(msg); } catch { /* parent gone */ } };
    const quit = async (code) => {
        await Promise.allSettled([pools.source.end(), pools.local.end()]);
        process.exit(code);
    };
    // The parent is gone (the app quit, or it was killed): nothing will ask for a cycle.
    process.on("disconnect", () => void quit(0));
    process.on("message", async (msg) => {
        if (!msg) return;
        if (msg.type === "quit") return quit(0);
        if (msg.type !== "run") return;
        let code;
        try {
            code = await main(parseArgs(msg.args || []), cfg, pools, {
                onReading: () => send({ type: "reading" }),
                onApplied: (info) => send({ type: "applied", ...info }),
            });
        } catch (e) {
            console.error(e);
            code = 1;
        }
        if (code === 0) send({ type: "done", code });
        else await quit(code);
    });
}

// Only when run as a command. Requiring this file (a test, a tool) must not start a
// sync cycle as a side effect — and `repairReferencing` is worth being able to call
// against a scratch pair of databases without provisioning all 116 tables.
if (require.main === module) {
    const argv = process.argv.slice(2);
    if (argv.includes("--serve")) {
        serve().catch((e) => {
            console.error(e);
            process.exit(1);
        });
    } else {
        main(parseArgs(argv), loadConfig())
            .then((code) => process.exit(code))
            .catch((e) => {
                console.error(e);
                process.exit(1);
            });
    }
}

module.exports = { repairReferencing, main };
