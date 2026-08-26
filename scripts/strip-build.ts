#!/usr/bin/env node
// Build-time boundary for the shop/office deployment split. Runs as the FIRST step of
// `pnpm build`, before `next build`. On every mode except `public` it is a no-op. On
// the public build (APP_MODE=public) it deletes office-only source from THIS checkout
// before Next.js ever sees it — absence, not a runtime gate, because a route that was
// never installed can't be attacked and can't be reached by a proxy bypass
// (CVE-2025-29927 territory).
//
// Renamed from strip-public-build.mjs (TypeScript now, so it can share appModeCore.ts's
// mode contract instead of re-deriving APP_MODE with its own fallback logic).
//
// `office` and `counter` do NOT go through this script — see the note in
// `scripts/counter-build.ts`. This script's `rmSync` is only safe because Vercel gives
// `public` a fresh, throwaway git clone per build; the desktop variants build inside a
// developer's real working tree, where a permanent delete would eat uncommitted work on
// a failed or misconfigured build. They use counter-build.ts's rename-and-restore
// wrapper instead.
//
// Vercel does a fresh git clone per build, so deleting files here only affects this one
// build's ephemeral checkout — never the repo, never another build's checkout. Safe to
// run from a normal working tree too, BUT it is destructive: never run this with
// APP_MODE=public against a tree you care about. Prove it in a throwaway `git worktree`
// first (see the deployment-separation roadmap, Phase 2).
//
// Adding a segment to PUBLIC_API_ALLOWLIST publishes it to the internet. Think about
// that before you add one.

import { existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { parseAppMode, OFFICE_ONLY_APP_PATHS, PUBLIC_API_ALLOWLIST } from "../src/shared/lib/appModeCore";

// Anchored to this file, not to cwd: the electron build chain invokes the script from
// wrappers that don't always run at the repo root, and a ROOT that silently pointed
// somewhere else would make the strip a no-op (or, worse, resolve the office paths
// against the wrong tree).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// This runs as a bare process, first in the `build` chain — before Next.js or Prisma
// have loaded anything. On Vercel that's fine: APP_MODE is injected straight into the
// process env. Locally it isn't: only dotenv-aware tools (prisma.config.ts, `next
// build` itself) read .env.local, so without this, APP_MODE=public in .env.local would
// be invisible here and the script would silently no-op on a local `pnpm build`. Real
// process.env (Vercel) still wins — dotenv.config() never overwrites a variable that's
// already set.
dotenv.config({ path: join(ROOT, ".env.local") });
dotenv.config({ path: join(ROOT, ".env") });

const mode = parseAppMode(process.env.APP_MODE);

if (mode !== "public") {
    console.log(`[strip-build] APP_MODE=${mode} — not the public build, nothing stripped here.`);
    process.exit(0);
}

// Vercel injects VERCEL=1 into every build it runs — that's a fresh, throwaway git
// clone, so deleting files there is safe. Outside Vercel this is someone's real working
// tree (or a deliberate throwaway `git worktree`, which the deployment-separation
// roadmap Phase 2 uses to prove the strip locally) — require an explicit opt-in so a
// stray local APP_MODE=public can't silently delete office source again like it did on
// 2026-08-25.
if (!process.env.VERCEL && process.env.ALLOW_LOCAL_PUBLIC_STRIP !== "1") {
    console.error(
        "[strip-build] ERROR: APP_MODE=public outside Vercel. This DELETES "
        + "office source files from disk. If this is a throwaway git worktree you "
        + "intend to discard, rerun with ALLOW_LOCAL_PUBLIC_STRIP=1. Refusing to run."
    );
    process.exit(1);
}

const APP_DIR = join(ROOT, "src", "app");
const API_DIR = join(APP_DIR, "api");

let deletedCount = 0;

function removePath(path: string, label: string): void {
    if (!existsSync(path)) return;
    rmSync(path, { recursive: true, force: true });
    deletedCount += 1;
    console.log(`[strip-build] removed ${label}`);
}

console.log("[strip-build] APP_MODE=public — stripping office-only source…");

for (const relPath of OFFICE_ONLY_APP_PATHS) {
    const path = join(APP_DIR, relPath);
    removePath(path, path.slice(ROOT.length + 1).replace(/\\/g, "/"));
}

if (existsSync(API_DIR)) {
    for (const entry of readdirSync(API_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue; // route.ts directly under api/ — none today, but don't touch stray files
        if (PUBLIC_API_ALLOWLIST.has(entry.name)) continue;
        removePath(join(API_DIR, entry.name), `src/app/api/${entry.name}`);
    }
} else {
    console.warn("[strip-build] WARNING: src/app/api not found — nothing to allowlist against.");
}

console.log(`[strip-build] done — ${deletedCount} path(s) removed.`);
console.log(`[strip-build] public API allowlist kept: ${[...PUBLIC_API_ALLOWLIST].join(", ")}`);

if (deletedCount === 0) {
    // A public build that silently stripped nothing is a failure mode, not a quiet
    // success — fail loud so it can't ship by accident.
    console.error("[strip-build] ERROR: expected to remove at least one office path but removed none. Refusing to continue.");
    process.exit(1);
}
