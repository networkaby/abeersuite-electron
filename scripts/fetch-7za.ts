#!/usr/bin/env node
/**
 * Puts `7za.exe` into `resources/` so the packaged app can unpack an update itself.
 *
 * Run once per build machine (and again on an electron-builder bump):
 *
 *     pnpm 7za:fetch
 *
 * ── Why the app needs its own 7-Zip ──────────────────────────────────────────
 * Until now the only thing that ever unpacked a release was NSIS, inside the installer,
 * with the app already dead. That is the whole cost of an update on a counter: measured
 * 2026-09-15, the payload is 169.7 MB of LZMA that expands to 627 MB across 14,823
 * files, and unpacking it took 94 s on a developer machine — several minutes on a till.
 * All of it downtime.
 *
 * `electron/stagedUpdate.ts` moves that work to BEFORE the restart, while the counter is
 * still billing, and leaves only a folder rename for the moment the app is down. To do
 * that it has to open the downloaded installer and its inner `app-64.7z` on its own, so
 * it needs a 7-Zip that is on disk at runtime — hence this file, and the matching
 * `extraResources` entry in package.json.
 *
 * ── Why it is fetched rather than committed ──────────────────────────────────
 * Same reason as `resources/pgsql` (see scripts/fetch-pg.ts): a binary does not belong
 * in git. The difference is that nothing here is downloaded by hand — electron-builder
 * already pins this exact binary and its SHA-256 (`app-builder-lib/out/toolsets/7zip`),
 * and every machine that has ever packed a build has it in the electron-builder cache.
 * Asking that module for the path reuses its pinned version and its checksum check, and
 * downloads it the same way if the cache is cold. Copying its answer is all this does.
 */

import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const DEST = path.join(process.cwd(), "resources", "7za.exe");

async function main(): Promise<void> {
    if (process.platform !== "win32") {
        console.log("[7za] Not Windows — the staged updater is Windows-only, skipping.");
        return;
    }

    // Resolved through electron-builder's own toolset module so the version and the
    // SHA-256 stay pinned in exactly one place: theirs. app-builder-lib is electron-
    // builder's dependency rather than ours, so it is reached THROUGH electron-builder
    // — under pnpm's strict layout a bare import of it does not resolve from here.
    const req = createRequire(import.meta.url);
    const fromBuilder = createRequire(req.resolve("electron-builder"));
    const toolset = pathToFileURL(fromBuilder.resolve("app-builder-lib/out/toolsets/7zip")).href;
    const { getPath7za } = (await import(toolset)) as { getPath7za: () => Promise<string> };
    const source = await getPath7za();
    if (!existsSync(source)) throw new Error(`electron-builder reported a 7za at ${source}, but it is not there.`);

    mkdirSync(path.dirname(DEST), { recursive: true });
    copyFileSync(source, DEST);
    console.log(`[7za] ${source} -> ${DEST} (${(statSync(DEST).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
    console.error("[7za] Failed:", err);
    process.exit(1);
});
