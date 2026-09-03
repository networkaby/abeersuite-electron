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
 * Nothing is transferred unless --keys is passed for a table that disagrees.
 *
 *   node verify-replica.js            count + key checksum for every table
 *   node verify-replica.js --keys     also list the differing ids (transfers keys)
 *   node verify-replica.js --only Person
 */

const fs = require("node:fs");
const path = require("node:path");
const { configPath } = require("./lib/configPath");
const { pool } = require("./lib/db");
const registryLib = require("./lib/registry");
const reconcile = require("./lib/reconcile");

const args = process.argv.slice(2);
const SHOW_KEYS = args.includes("--keys");
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

    try {
        for (const model of models) {
            const entry = tables[model];
            try {
                // Source first for a full table: the local hash keeps only the source's
                // columns (see reconcile.js), so it needs that list.
                const a = await reconcile.fingerprint(source, entry);
                const b = await reconcile.fingerprint(local, entry, a.columns || []);
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

        if (SHOW_KEYS) {
            for (const b of bad) {
                if (b.error) continue;
                const extra = await reconcile.missingLocally(source, local, b.entry);
                if (extra.length) {
                    console.log(`\n  ${b.model}: ${extra.length} key(s) present locally but gone from source`);
                    console.log(`    ${extra.slice(0, 20).join(", ")}${extra.length > 20 ? " ..." : ""}`);
                }
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
        console.log("Replica matches the source exactly.");
        process.exit(0);
    }
    console.log(`${bad.length} table(s) disagree.`);
    if (!SHOW_KEYS) console.log("Re-run with --keys to list the differing ids.");
    process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
