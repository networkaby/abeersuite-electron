#!/usr/bin/env node
/**
 * Stages a `node_modules` beside each bundled worker, so their `require`s resolve on a
 * customer's machine.
 *
 * ── The bug this fixes ───────────────────────────────────────────────────────
 * `sync-engine/` and `hardware-bridge/` ship as plain directories under `resources/`
 * and run as child processes. Node resolves their `require("pg")` by walking UP the
 * directory tree — and in a packaged install there is nothing above them to find:
 * `resources/node_modules`, `win-unpacked/node_modules` and the app root all have no
 * such directory.
 *
 * On a development machine it walks further up still, reaches the repo's own
 * `node_modules`, and works — which is exactly why this was invisible until it was
 * tested from a directory outside the repo. Verified 2026-08-26: copying the packaged
 * `sync-engine` to a temp dir and resolving from there gives MODULE_NOT_FOUND for both
 * `pg` and `@supabase/supabase-js`. Left unfixed, every counter would start its sync
 * worker, fail instantly, and read Supabase forever — the precise cost this project
 * exists to remove, reintroduced by a packaging detail.
 *
 * The staged directories are gitignored build output, regenerated on every build.
 */

import * as fs from "fs";
import * as path from "path";
import { hoistNodeModules } from "./lib/hoistNodeModules";

/**
 * What each worker actually requires, excluding Node builtins and its own relative
 * files. Derived by grepping the sources, not by guessing:
 *
 *   sync-engine     — lib/db.js (pg), lib/signal.js (@supabase/supabase-js)
 *   hardware-bridge — thermal.js (express, node-thermal-printer, qrcode, sharp),
 *                     qr.js (sharp, serialport, qrcode), cors-pna.js (cors)
 *
 * `sharp` and `serialport` are NATIVE, and were expected to need an Electron ABI rebuild
 * (Electron 43 is ABI 148; the Node that builds here is 137). They do not: both ship as
 * **N-API** addons, so one binary serves every ABI. Verified by loading them under
 * `ELECTRON_RUN_AS_NODE` — the runtime the workers actually use — where they load as
 * cleanly as under plain Node.
 *
 * That is a property of these two packages, not a general rule. A future native
 * dependency that is NOT N-API needs `@electron/rebuild` adding to this chain. Note
 * `asarUnpack` is not part of that: these workers ship via `extraResources`, so their
 * binaries already sit on a real path beside the asar rather than inside it.
 */
const BRIDGE_DEPS: Record<string, string[]> = {
    "sync-engine": ["pg", "@supabase/supabase-js"],
    "hardware-bridge": ["express", "cors", "node-thermal-printer", "qrcode", "sharp", "serialport"],
};

function stage(bridge: string, deps: string[], rootDir: string): void {
    const bridgeDir = path.join(rootDir, bridge);
    if (!fs.existsSync(bridgeDir)) {
        console.error(`[prepare-bridge-deps] FATAL: ${bridge}/ does not exist.`);
        process.exit(1);
    }

    const rootNodeModules = path.join(rootDir, "node_modules");
    const missing = deps.filter((name) => !fs.existsSync(path.join(rootNodeModules, name)));
    if (missing.length > 0) {
        console.error(
            `[prepare-bridge-deps] FATAL: ${bridge} needs ${missing.join(", ")}, `
            + "which are not installed. Run 'pnpm install'.",
        );
        process.exit(1);
    }

    // Seed with the packages themselves rather than the whole root node_modules —
    // hoisting that would copy every top-level dependency. Same approach, and the same
    // reason, as prepare-electron-deps.ts.
    const seedDir = path.join(rootDir, `.${bridge}-deps-seed`);
    fs.rmSync(seedDir, { recursive: true, force: true });
    fs.mkdirSync(seedDir, { recursive: true });
    for (const name of deps) {
        const link = path.join(seedDir, name);
        fs.mkdirSync(path.dirname(link), { recursive: true }); // scoped names like @supabase/…
        fs.symlinkSync(path.join(rootNodeModules, name), link, "junction");
    }

    const destDir = path.join(bridgeDir, "node_modules");
    fs.rmSync(destDir, { recursive: true, force: true });
    const count = hoistNodeModules(destDir, [seedDir], { stripSuffixes: [".d.ts", ".map"] });
    fs.rmSync(seedDir, { recursive: true, force: true });

    for (const name of deps) {
        if (!fs.existsSync(path.join(destDir, name, "package.json"))) {
            console.error(`[prepare-bridge-deps] FATAL: ${bridge}/node_modules/${name} did not survive the hoist.`);
            process.exit(1);
        }
    }

    console.log(`[prepare-bridge-deps] ${bridge}: hoisted ${count} package(s).`);
}

function main(): void {
    const rootDir = process.cwd();
    for (const [bridge, deps] of Object.entries(BRIDGE_DEPS)) {
        stage(bridge, deps, rootDir);
    }
}

main();
