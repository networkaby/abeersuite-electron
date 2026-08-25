#!/usr/bin/env node
// Build-time boundary for the shop/office deployment split. Runs as the
// FIRST step of `pnpm build`, before `next build`. On the office build it is
// a no-op. On the public build (APP_MODE=public) it deletes office-only
// source from THIS checkout before Next.js ever sees it — absence, not a
// runtime gate, because a route that was never installed can't be attacked
// and can't be reached by a proxy bypass (CVE-2025-29927 territory).
//
// Vercel does a fresh git clone per build, so deleting files here only
// affects this one build's ephemeral checkout — never the repo, never the
// office build's checkout. Safe to run from a normal working tree too, BUT
// it is destructive: never run this with APP_MODE=public against a tree you
// care about. Prove it in a throwaway `git worktree` first (see the
// deployment-separation roadmap, Phase 2).
//
// Adding a segment to PUBLIC_API_ALLOWLIST publishes it to the internet.
// Think about that before you add one.

import { existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

// Anchored to this file, not to cwd: the electron build chain invokes the
// script from wrappers that don't always run at the repo root, and a ROOT that
// silently pointed somewhere else would make the strip a no-op (or, worse,
// resolve the office paths against the wrong tree).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// This runs as a bare `node` process, first in the `build` chain — before
// Next.js or Prisma have loaded anything. On Vercel that's fine: APP_MODE is
// injected straight into the process env. Locally it isn't: only dotenv-aware
// tools (prisma.config.ts, `next build` itself) read .env.local, so without
// this, APP_MODE=public in .env.local would be invisible here and the script
// would silently no-op on a local `pnpm build`. Real process.env (Vercel)
// still wins — dotenv.config() never overwrites a variable that's already set.
dotenv.config({ path: join(ROOT, ".env.local") });
dotenv.config({ path: join(ROOT, ".env") });

const APP_MODE = process.env.APP_MODE === "public" ? "public" : "full";

if (APP_MODE !== "public") {
    console.log("[strip-public-build] APP_MODE is not \"public\" — full (office) build, nothing stripped.");
    process.exit(0);
}

// Vercel injects VERCEL=1 into every build it runs — that's a fresh, throwaway
// git clone, so deleting files there is safe. Outside Vercel this is someone's
// real working tree (or a deliberate throwaway `git worktree`, which the
// deployment-separation roadmap Phase 2 uses to prove the strip locally) —
// require an explicit opt-in so a stray local APP_MODE=public can't silently
// delete office source again like it did on 2026-08-25.
if (!process.env.VERCEL && process.env.ALLOW_LOCAL_PUBLIC_STRIP !== "1") {
    console.error(
        "[strip-public-build] ERROR: APP_MODE=public outside Vercel. This DELETES "
        + "office source files from disk. If this is a throwaway git worktree you "
        + "intend to discard, rerun with ALLOW_LOCAL_PUBLIC_STRIP=1. Refusing to run."
    );
    process.exit(1);
}

const APP_DIR = join(ROOT, "src", "app");
const API_DIR = join(APP_DIR, "api");

// Every top-level src/app/api segment the PUBLIC build is allowed to keep.
// Default-deny: anything not listed here is stripped automatically, so a new
// office API route added without touching this file is safe by default.
//   auth             — NextAuth; portal login rides it (credentials-portal*)
//   portal           — customer portal (orders, social, OTP, account switch)
//   shop             — storefront (cart, checkout, products, payment/courier webhooks)
//   upload-signature — Cloudinary signed-upload default endpoint (avatar/post uploads)
//   legal            — fetched anonymously by Razorpay/Google verification and by
//                       the separate company site's build, not by this app's UI
const PUBLIC_API_ALLOWLIST = new Set(["auth", "portal", "shop", "upload-signature", "legal"]);

// Whole subtrees that are office-only regardless of what's under src/app/api.
const OFFICE_ONLY_APP_PATHS = [
    join(APP_DIR, "(protected)"),   // office, vouchers, lab
    join(APP_DIR, "staff"),
    join(APP_DIR, "receipt"),       // staff print surfaces — see requireAuthPage() on each page
    join(APP_DIR, "shipping-label"),
    join(APP_DIR, "shipping-slip"),
];

let deletedCount = 0;

function removePath(path, label) {
    if (!existsSync(path)) return;
    rmSync(path, { recursive: true, force: true });
    deletedCount += 1;
    console.log(`[strip-public-build] removed ${label}`);
}

console.log("[strip-public-build] APP_MODE=public — stripping office-only source…");

for (const path of OFFICE_ONLY_APP_PATHS) {
    removePath(path, path.slice(ROOT.length + 1).replace(/\\/g, "/"));
}

if (existsSync(API_DIR)) {
    for (const entry of readdirSync(API_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue; // route.ts directly under api/ — none today, but don't touch stray files
        if (PUBLIC_API_ALLOWLIST.has(entry.name)) continue;
        removePath(join(API_DIR, entry.name), `src/app/api/${entry.name}`);
    }
} else {
    console.warn("[strip-public-build] WARNING: src/app/api not found — nothing to allowlist against.");
}

console.log(`[strip-public-build] done — ${deletedCount} path(s) removed.`);
console.log(`[strip-public-build] public API allowlist kept: ${[...PUBLIC_API_ALLOWLIST].join(", ")}`);

if (deletedCount === 0) {
    // A public build that silently stripped nothing is a failure mode, not a
    // quiet success — fail loud so it can't ship by accident.
    console.error("[strip-public-build] ERROR: expected to remove at least one office path but removed none. Refusing to continue.");
    process.exit(1);
}
