import * as fs from "fs";
import * as path from "path";
import { hoistNodeModules } from "./lib/hoistNodeModules";

/**
 * The Electron main process (`electron/main.ts`) has exactly two runtime `require`s
 * outside Node builtins and the `electron` module itself: `dotenv` and
 * `electron-updater`. Everything else in `package.json`'s "dependencies" — Next,
 * React, Prisma, Dexie, the lot — belongs to the web app, which already carries its
 * own complete `resources/standalone/node_modules` from `prepare-standalone.ts`.
 *
 * Without this, electron-builder's default packaging computes the closure of ALL of
 * "dependencies" (this project's package.json mixes the Next app's and the Electron
 * shell's dependencies in one list) and bundles the whole thing a second time — the
 * 2026-08-24 size audit measured that as 646 MB of `app.asar.unpacked/node_modules`,
 * none of which `dist-electron/main.js` ever requires. This hoists ONLY the two real
 * runtime deps (+ their own transitive closure) into `dist-electron/node_modules`,
 * so `package.json`'s `files`/`asarUnpack` can drop the top-level `node_modules`
 * entirely and `require("dotenv")` / `require("electron-updater")` still resolve —
 * Node's module resolution walks up from `dist-electron/`, and this directory is
 * inside it.
 */
const ELECTRON_RUNTIME_DEPS = ["dotenv", "electron-updater"];

function main(): void {
    const rootDir = process.cwd();
    const rootNodeModules = path.join(rootDir, "node_modules");
    const destDir = path.join(rootDir, "dist-electron", "node_modules");

    const missing = ELECTRON_RUNTIME_DEPS.filter((name) => !fs.existsSync(path.join(rootNodeModules, name)));
    if (missing.length > 0) {
        console.error(`[prepare-electron-deps] FATAL: missing from node_modules: ${missing.join(", ")}. Run 'pnpm install'.`);
        process.exit(1);
    }

    // Seed with the two packages directly (pnpm symlinks resolved via realpathSync
    // inside hoistNodeModules) rather than the whole root node_modules — that would
    // walk and copy every top-level dependency, exactly what this script exists to avoid.
    const seedDir = path.join(rootDir, ".electron-deps-seed");
    fs.rmSync(seedDir, { recursive: true, force: true });
    fs.mkdirSync(seedDir, { recursive: true });
    for (const name of ELECTRON_RUNTIME_DEPS) {
        fs.symlinkSync(path.join(rootNodeModules, name), path.join(seedDir, name), "junction");
    }

    const count = hoistNodeModules(destDir, [seedDir], { stripSuffixes: [".d.ts", ".map"] });
    fs.rmSync(seedDir, { recursive: true, force: true });

    for (const name of ELECTRON_RUNTIME_DEPS) {
        if (!fs.existsSync(path.join(destDir, name, "package.json"))) {
            console.error(`[prepare-electron-deps] FATAL: dist-electron/node_modules/${name} did not survive the hoist.`);
            process.exit(1);
        }
    }

    console.log(`[prepare-electron-deps] Hoisted ${count} package(s) into dist-electron/node_modules.`);
}

main();
