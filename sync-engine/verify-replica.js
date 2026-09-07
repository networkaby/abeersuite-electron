"use strict";

/**
 * Compares every replicated table against the source and reports disagreement.
 *
 * This is the question the whole project rests on -- "is the replica actually
 * right?" -- and it needs a real answer rather than an assumption, because the
 * failure mode is silent. A replica that is missing rows does not error; it renders
 * a report with fewer lines, which reads as "those records do not exist" rather than
 * "this database is behind".
 *
 * Cheap enough to run often: one aggregate per table per side, returning two numbers.
 * Rows are only transferred for a table that already disagrees, and only when --keys,
 * --deep or --repair asks which rows they are.
 *
 *   node verify-replica.js            count + key checksum for every table
 *   node verify-replica.js --keys     also list the differing ids (transfers keys)
 *   node verify-replica.js --only Person
 *   node verify-replica.js --totals   also prove each side's running totals against
 *                                     its OWN ledger (totals never travel — see
 *                                     lib/rebuildTotals.js)
 *   node verify-replica.js --deep     hash the whole ROW, not just the key
 *   node verify-replica.js --deep --repair   ...and re-pull the rows that disagree
 *
 * ── Why --deep exists, and why it is not the default ───────────────────────
 * The ordinary run hashes primary keys, so it answers "is a row missing or extra?"
 * and nothing more. A row present on BOTH sides with DIFFERENT CONTENT reads as
 * agreement — and that is a real state, not a theoretical one: an ON DELETE SET NULL
 * fires inside PostgreSQL on the source, so Prisma's @updatedAt never runs and no
 * delta pull revisits the row, while the replica applies deletes with FK actions
 * suspended and so never makes the matching change. This tool would call such a table
 * clean, which is the worst thing an audit tool can do.
 *
 * --deep hashes `to_jsonb(row)` instead, and closes that. Opt-in because it reads
 * every row on BOTH sides, and paying that against Supabase is the egress this project
 * exists to avoid. Reach for it when you suspect a divergence, or after a hard delete
 * on the office; the engine's own repair (repairReferencing in sync-once.js) is what
 * keeps new ones from accumulating.
 *
 * --repair only acts on what a comparison already found, and never runs on its own: a
 * tool that silently rewrites rows is not one you can trust the first time.
 */

const fs = require("node:fs");
const path = require("node:path");
const { configPath } = require("./lib/configPath");
const { pool } = require("./lib/db");
const { pullByKeys, deleteByKeys } = require("./lib/pull");
const registryLib = require("./lib/registry");
const reconcile = require("./lib/reconcile");
const totals = require("./lib/rebuildTotals");

const args = process.argv.slice(2);
const SHOW_KEYS = args.includes("--keys");
const TOTALS = args.includes("--totals");
const DEEP = args.includes("--deep");
const REPAIR = args.includes("--repair");
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

function loadConfig() {
    const p = configPath();
    if (!fs.existsSync(p)) {
        console.error(`No config.json at ${p}.`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
    const cfg = loadConfig();
    const registryPath = cfg.registryPath
        ? path.resolve(__dirname, cfg.registryPath)
        : registryLib.defaultRegistryPath();
    const { tables } = registryLib.load(registryPath);

    const sp = pool(cfg.sourceUrl, 2);
    const lp = pool(cfg.localUrl, 2);
    const source = await sp.connect();
    const local = await lp.connect();

    const models = Object.keys(tables).filter((m) => !ONLY || m === ONLY).sort();
    const bad = [];
    let checked = 0;
    let srcRows = 0;
    let locRows = 0;
    let repairedTables = 0;
    let repairedRows = 0;

    try {
        for (const model of models) {
            const entry = tables[model];
            try {
                // Source first for a full table: the local hash keeps only the source's
                // columns (see reconcile.js), so it needs that list. --deep asks the
                // same question of every strategy, over the whole row rather than the key.
                const a = DEEP
                    ? await reconcile.contentFingerprint(source, entry)
                    : await reconcile.fingerprint(source, entry);
                const b = DEEP
                    ? await reconcile.contentFingerprint(local, entry, a.columns || [])
                    : await reconcile.fingerprint(local, entry, a.columns || []);
                checked++;
                srcRows += Number(a.count);
                locRows += Number(b.count);
                if (!reconcile.same(a, b)) {
                    bad.push({ model, entry, src: a, loc: b });
                    const delta = Number(b.count) - Number(a.count);
                    console.log(
                        `  DIFFERS  ${model.padEnd(28)} source=${a.count.padStart(7)}  replica=${b.count.padStart(7)}` +
                        (delta === 0 ? "  (same count, different contents)" : `  (${delta > 0 ? "+" : ""}${delta})`),
                    );
                }
            } catch (e) {
                bad.push({ model, entry, error: e.message });
                console.log(`  ERROR    ${model.padEnd(28)} ${e.message}`);
            }
        }

        if (TOTALS) {
            // Each side against ITS OWN ledger. The two sides' totals legitimately
            // differ while a sale is still in this counter's outbox; what must never
            // happen is a total disagreeing with the ledger beneath it.
            for (const [label, client] of [["source", source], ["replica", local]]) {
                const d = await totals.driftReport(client);
                const n = d.accounts + d.products + d.branches + d.giftCards;
                console.log(`  totals   ${label.padEnd(28)} ${n === 0 ? "in step with ledger" : `DRIFT accounts=${d.accounts} products=${d.products} branches=${d.branches} giftCards=${d.giftCards}`}`);
                if (n > 0) bad.push({ model: `totals@${label}`, entry: null, error: "running totals drift from ledger" });
            }
        }

        if (SHOW_KEYS || DEEP || REPAIR) {
            for (const b of bad) {
                if (!b.entry || b.error) continue;

                // A replica whose schema is behind the source has nowhere to put the new
                // column, so every row reads as different — one schema fact, not N drifted
                // rows. Say so, and do not offer to repair it: upsert names the source's
                // columns, so it would fail on every batch.
                const missing = reconcile.missingColumns(b.src, b.loc);
                if (missing.length) {
                    console.log(`\n  ${b.model}: replica is MISSING column(s) ${missing.join(", ")}`);
                    console.log("    Every row differs for that reason alone. Update the replica schema;");
                    console.log("    not comparing rows or repairing this table.");
                    continue;
                }

                const diff = await reconcile.keyDiff(source, local, b.entry);
                // Rows present on both sides whose contents disagree. Only a deep run
                // can see these, and they are the ones no amount of waiting repairs.
                const drifted = DEEP
                    ? await reconcile.rowHashDiff(source, local, b.entry, b.src.columns || [])
                    : [];

                const show = (label, keys) => {
                    if (keys.length === 0) return;
                    console.log(`\n  ${b.model}: ${keys.length} key(s) ${label}`);
                    console.log(`    ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? " ..." : ""}`);
                };
                show("present locally but gone from source", diff.onlyLocal);
                show("present on source but missing here", diff.onlySource);
                show("on both sides with DIFFERENT content", drifted);

                if (!REPAIR) continue;

                const removed = await deleteByKeys(local, b.entry, diff.onlyLocal);
                const added = await pullByKeys(source, local, b.entry, diff.onlySource);
                const refreshed = await pullByKeys(source, local, b.entry, drifted);
                repairedTables++;
                repairedRows += removed + added + refreshed;
                console.log(`  ${b.model}: repaired -${removed} +${added} ~${refreshed}`);
            }
        }
    } finally {
        source.release();
        local.release();
        await sp.end();
        await lp.end();
    }

    console.log("");
    console.log(`${checked} table(s) compared. source=${srcRows} rows, replica=${locRows} rows.`);
    if (bad.length === 0) {
        console.log(DEEP
            ? "Replica matches the source exactly, row contents included."
            : "Replica matches the source exactly.");
        // Keys agreeing is not the same claim as rows agreeing, and saying so plainly
        // is the point: this tool used to report a content divergence as clean.
        if (!DEEP) console.log("Keys only — re-run with --deep to compare row contents.");
        process.exit(0);
    }
    console.log(`${bad.length} table(s) disagree.`);
    if (repairedTables > 0) {
        console.log(`Repaired ${repairedRows} row(s) across ${repairedTables} table(s). Re-run to confirm.`);
    } else if (!SHOW_KEYS && !DEEP) {
        console.log("Re-run with --keys to list the differing ids, or --deep to compare row contents.");
    } else if (!REPAIR) {
        console.log("Re-run with --repair to fix these from the source.");
    }
    process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
