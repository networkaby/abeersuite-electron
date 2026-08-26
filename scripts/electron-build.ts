/**
 * Entry point for `pnpm electron:build` — loads `.env.counter` before anything else in
 * the chain runs, then spawns the existing build steps.
 *
 * Why this has to exist: `APP_MODE` decides what `strip-build.ts` deletes and what
 * `counter-build.ts` excludes, and both run as part of `pnpm build`, which is the FIRST
 * step of this chain. `generate-counter-env.ts` (which reads `.env.counter` today) only
 * runs AFTER the Next build, far too late to influence it. Loading `.env.counter` here,
 * once, at the top — before spawning any child — is what makes "set APP_MODE and
 * LANDING_PAGE in .env.counter, then build" actually produce the variant asked for.
 * Every child process below inherits `process.env`, so no further plumbing is needed.
 *
 * `.env.counter` is also what `generate-counter-env.ts` reads to decide which secrets
 * to bake into `resources/counter.env` — loading it here and there from the same file
 * keeps "which variant" and "which keys" answering from one source instead of two.
 */
import { spawnSync } from "child_process";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseAppMode, resolveLandingPage } from "../src/shared/lib/appModeCore";

const ROOT = path.join(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env.counter") });

const mode = parseAppMode(process.env.APP_MODE);
const landingPage = resolveLandingPage(mode, process.env);

console.log(`[electron-build] Building variant: APP_MODE=${mode}, LANDING_PAGE=${landingPage}`);
if (mode === "full" || mode === "public") {
    console.warn(
        `[electron-build] WARNING: APP_MODE=${mode} is normally a Vercel mode, not a desktop ` +
        "one. Building it as a desktop installer anyway — this is allowed, just unusual."
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

console.log(`[electron-build] Done — APP_MODE=${mode} build ready.`);
