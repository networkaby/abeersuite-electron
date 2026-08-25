/**
 * Publishes an ALREADY-VERIFIED build to the update-only releases repo
 * (`devloperakramul/abeersuite-networkservice-update`).
 *
 * Deliberately not "build and publish in one step". `pnpm electron:release`
 * (package.json) runs `electron:pack` first — build, `electron-builder --dir`,
 * then `verify:package` — and only calls this script once that gate has passed.
 * This script then packs and publishes from that EXACT verified
 * `dist-app/win-unpacked` tree via `--prepackaged`, rather than rebuilding, so
 * there is no window where an unverified build could reach the public release.
 *
 * `electron-builder`'s GitHub publish provider reads `GH_TOKEN` straight from
 * `process.env` — it does not load `.env` itself the way the Next app does. This
 * script does that loading, and only that: `GH_TOKEN` (write access to the
 * releases repo) must live in the **build machine's own `.env`**, never in
 * `scripts/counterEnv.ts`'s `COUNTER_ENV_COPIED` — that is the allowlist baked
 * into every counter, and this token can create releases, which a shipped
 * counter must never be able to do. `verify-package.ts` would fail the build if
 * this leaked into `counter.env`, but the point is for it to never be offered.
 */
import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { spawnSync } from "child_process";

loadDotenv({ path: path.join(process.cwd(), ".env") });

if (!process.env.GH_TOKEN) {
    console.error(
        "[release-electron] FATAL: GH_TOKEN is not set in .env.\n" +
        "  Create a fine-grained PAT scoped to ONLY devloperakramul/abeersuite-networkservice-update,\n" +
        "  permission Contents: Read and write, and add it to .env as GH_TOKEN=..."
    );
    process.exit(1);
}

const prepackaged = path.join(process.cwd(), "dist-app", "win-unpacked");
if (!fs.existsSync(path.join(prepackaged, "AbeerSuite.exe"))) {
    console.error(
        `[release-electron] FATAL: ${prepackaged} has no AbeerSuite.exe.\n` +
        "  Run via 'pnpm electron:release' (which runs electron:pack first) — never this script alone."
    );
    process.exit(1);
}

console.log("[release-electron] Publishing the verified build in dist-app/win-unpacked to devloperakramul/abeersuite-networkservice-update...");

const result = spawnSync("electron-builder", ["--publish", "always", "--prepackaged", prepackaged], {
    stdio: "inherit",
    shell: true,
    env: process.env,
});

process.exit(result.status ?? 1);
