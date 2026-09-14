/**
 * Entry point for `pnpm electron:build` — loads environment variables before anything else in
 * the chain runs, then spawns the existing build steps.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseAppMode, resolveLandingPage } from "../src/shared/lib/appModeCore";

const ROOT = path.join(__dirname, "..");

// `.env` ONLY — `.env.local` is deliberately not loaded here.
//
// This is not just about the two values this file reads. Every step below is spawned
// with `childEnv = {...process.env}`, and `generate-counter-env.ts` falls back to
// `process.env[key]` for any key its `.env` lookup does not supply — so anything loaded
// here can end up BAKED INTO THE INSTALLER. `.env.local` holds web-version dev
// overrides; `.env` holds the counter/office build's real configuration. Loading the dev
// file with `override: true` meant a `READ_MODE`/`WRITE_MODE`/`DATABASE_URL` uncommented
// for an afternoon of web work silently decided what shipped to every counter.
dotenv.config({ path: path.join(ROOT, ".env") });

const mode = parseAppMode(process.env.APP_MODE);
const landingPage = resolveLandingPage(mode, process.env);

console.log(`[electron-build] Building variant: APP_MODE=${mode}, LANDING_PAGE=${landingPage}`);
if (mode === "full" || mode === "public") {
    console.warn(
        `[electron-build] WARNING: APP_MODE=${mode} is normally a Vercel mode, not a desktop ` +
        "one. Building it as a desktop installer anyway — this is allowed, just unusual."
    );
}

// A desktop installer without the embedded PostgreSQL still works — it just can never
// have a local replica, so every read goes to Supabase forever. That is a quiet, costly
// difference to ship by accident, so say it plainly. Not fatal: a quick office build to
// test something unrelated should not be blocked on an 80 MB fetch.
if (!fs.existsSync(path.join(ROOT, "resources", "pgsql", "bin"))) {
    console.warn(
        "[electron-build] WARNING: resources/pgsql is missing — this installer will ship WITHOUT " +
        "the embedded PostgreSQL, so counters built from it stay in live mode and read Supabase " +
        "for everything. Run `pnpm pg:fetch` first to bundle it."
    );
}

const childEnv = { ...process.env, COUNTER_BUILD: "1" };

function step(label: string, command: string, args: string[]): void {
    console.log(`[electron-build] → ${label}`);
    const result = spawnSync(command, args, { stdio: "inherit", cwd: ROOT, env: childEnv, shell: process.platform === "win32" });
    if (result.error) {
        console.error(`[electron-build] FAILED to start: ${label}`, result.error);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`[electron-build] FAILED at: ${label}`);
        process.exit(result.status ?? 1);
    }
}

step("pnpm build (strip + prisma generate + next build)", "pnpm", ["build"]);
step("prepare-standalone", "pnpm", ["exec", "tsx", "scripts/prepare-standalone.ts"]);
step("generate-counter-env", "pnpm", ["exec", "tsx", "scripts/generate-counter-env.ts"]);
step("electron:compile", "pnpm", ["run", "electron:compile"]);
step("prepare-electron-deps", "pnpm", ["exec", "tsx", "scripts/prepare-electron-deps.ts"]);
step("prepare-bridge-deps", "pnpm", ["exec", "tsx", "scripts/prepare-bridge-deps.ts"]);
// The window a counter shows while an update installs and the app itself is gone.
// Built here rather than by hand so the splash in a package always matches its source.
step("build-update-splash", "pnpm", ["exec", "tsx", "scripts/build-update-splash.ts"]);
// The 7-Zip the app uses to unpack an update BEFORE the restart rather than during it
// (electron/stagedUpdate.ts). Fetched here, not by hand: a package built without it
// still updates, just the slow way, and that difference is too quiet to leave to memory.
step("fetch-7za", "pnpm", ["exec", "tsx", "scripts/fetch-7za.ts"]);

console.log(`[electron-build] Done — APP_MODE=${mode} build ready.`);
