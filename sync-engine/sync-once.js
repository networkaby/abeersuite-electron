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
 *   node sync-once.js --only Ticket sync one model (and its children)
 *   node sync-once.js --reason signal   what woke this cycle (index.js passes it);
 *                                       signal|queued may trust a recent schema check
 *
 * Config: config.json beside this file (see config.example.json).
 */

const fs = require("node:fs");
const path = require("node:path");
const { pool, canSuspendForeignKeys } = require("./lib/db");
const registryLib = require("./lib/registry");
const state = require("./lib/state");
const { pullWatermark, pullFull, pullChildren, pullByKeys, deleteByKeys } = require("./lib/pull");
const reconcile = require("./lib/reconcile");
const schemaGuard = require("./lib/schemaGuard");
const status = require("./lib/status");
const { configPath } = require("./lib/configPath");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const reasonIdx = args.indexOf("--reason");
/** Why this cycle runs: startup | interval | signal | queued | manual (default). */
const REASON = reasonIdx >= 0 ? args[reasonIdx + 1] : "manual";

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

async function main() {
    const cfg = loadConfig();
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

    // One long-lived client per side for the bookkeeping (guard, state, reconcile,
    // status), plus one per lane for the table passes below.
    const sourcePool = pool(cfg.sourceUrl, CONCURRENCY + 1);
    const localPool = pool(cfg.localUrl, CONCURRENCY + 1);
    const source = await sourcePool.connect();
    const local = await localPool.connect();

    const t0 = Date.now();
    let pulledTotal = 0;
    /** Models this cycle actually wrote rows into — the payload of the "applied" line
     *  below. A model that pulled nothing is deliberately absent: the whole point is to
     *  leave screens alone when a cycle changed nothing they could see. */
    const changedModels = new Set();
    let failed = 0;
    let skipped = 0;
    let verified = 0;
    let repaired = 0;

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

        // Checked before anything is written: syncing into a replica of the wrong
        // shape produces rows that are quietly incomplete rather than an error.
        //
        // A signal-woken cycle may reuse the verdict of a recent full check instead:
        // startup, interval and retry cycles always compare, so drift is still caught
        // within the interval, and a missing or failed status row always compares.
        let schema = null;
        if (REASON === "signal" || REASON === "queued") {
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

        const want = (model) => !ONLY || model === ONLY || tables[model].parent === ONLY;

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

        // Pass 1: tables that stand on their own, CONCURRENCY at a time.
        await runLimited(order.independent.filter(want), CONCURRENCY, (model) => withLane(async (source, local) => {
            const entry = tables[model];
            try {
                let res;
                if (entry.strategy === "full") {
                    // A 'full' table is replaced wholesale, so re-pulling it every
                    // cycle would re-read reference data from Supabase forever. Two
                    // numbers on the wire decide whether that is necessary at all.
                    const [srcFp, localFp] = await Promise.all([
                        reconcile.fingerprint(source, entry),
                        reconcile.fingerprint(local, entry),
                    ]);
                    if (reconcile.same(srcFp, localFp)) {
                        skipped++;
                        // Still record the pass so every table has a freshness stamp.
                        if (!DRY) await state.recordSuccess(local, entry, model, null);
                        moved.set(model, []);
                        return;
                    }
                    res = DRY ? { pulled: -1, ids: [] } : await pullFull(source, local, entry);
                } else {
                    const since = prior.get(entry.n) ? prior.get(entry.n).watermark : null;
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
                        res = { pulled: 0, watermark: null, watermarkId: null, ids: [], more: true };
                        let cursor = since;
                        let cursorId = prior.get(entry.n) ? prior.get(entry.n).watermark_id : null;
                        let pages = 0;
                        while (res.more && pages < MAX_PAGES) {
                            const page = await pullWatermark(source, local, entry, cursor, cursorId, PAGE);
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
                if (!DRY) await state.recordSuccess(local, entry, model, res.watermark, res.watermarkId);
                if (res.pulled !== 0) {
                    console.log(`  ${model.padEnd(28)} ${entry.strategy.padEnd(9)} ${res.pulled === -1 ? "(full)" : res.pulled}`);
                }
            } catch (e) {
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
                    failed++;
                    console.error(`  ${model.padEnd(28)} FAILED: ${e.message}`);
                    if (!DRY) await state.recordFailure(local, entry, model, e).catch(() => {});
                }
            }));
        }
        // ---- Pass 3: reconcile a few tables against the source ----------------
        //
        // A watermark reports that a row CHANGED; it can never report that a row is
        // GONE. Without this pass a deleted invoice would sit on the counter forever,
        // and a row whose timestamp is behind our cursor could never be recovered.
        // Both directions are repaired.
        if (!DRY) {
            const nowMs = Date.now();
            const due = [...order.independent, ...order.children]
                .filter((m) => want(m))
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

            for (const model of due) {
                const entry = tables[model];
                try {
                    const [srcFp, locFp] = await Promise.all([
                        reconcile.fingerprint(source, entry),
                        reconcile.fingerprint(local, entry),
                    ]);
                    verified++;
                    if (reconcile.same(srcFp, locFp)) {
                        await state.recordVerified(local, entry, srcFp.count, srcFp.checksum);
                        continue;
                    }
                    // Only now pay to move keys.
                    const diff = await reconcile.keyDiff(source, local, entry);
                    const removed = await deleteByKeys(local, entry, diff.onlyLocal);
                    const added = await pullByKeys(source, local, entry, diff.onlySource);
                    repaired += removed + added;
                    // A repair changes what this replica serves just as a pull does, so
                    // the screens must hear about it (see __SYNC_APPLIED__ below).
                    if (removed + added > 0) changedModels.add(model);
                    console.log(
                        `  ${model.padEnd(28)} repair    -${removed} +${added}`,
                    );
                    const after = await reconcile.fingerprint(local, entry);
                    if (reconcile.same(srcFp, after)) {
                        await state.recordVerified(local, entry, after.count, after.checksum);
                    } else {
                        // Repaired but still not equal: the source moved underneath us,
                        // or something is wrong. Leave it unverified so the next cycle
                        // looks again rather than recording a proof we do not have.
                        console.log(`  ${model.padEnd(28)} still differs after repair`);
                    }
                } catch (e) {
                    failed++;
                    console.error(`  ${model.padEnd(28)} VERIFY FAILED: ${e.message}`);
                }
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
        await sourcePool.end();
        await localPool.end();
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

    // The one line in this program a machine reads. Printed AFTER every write has
    // committed and the pools are closed, so a reader that acts on it is guaranteed the
    // rows are already queryable -- which is the entire point: the app's screens used to
    // re-read the replica in parallel with this process and routinely beat it there.
    // Silent when nothing moved, so a no-op cycle wakes nobody. Rows repaired by the
    // reconcile pass count: they change what the replica serves exactly as a pull does.
    if (!DRY && pulledTotal + repaired > 0) {
        console.log(`__SYNC_APPLIED__ ${JSON.stringify({ rows: pulledTotal + repaired, models: [...changedModels] })}`);
    }
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
