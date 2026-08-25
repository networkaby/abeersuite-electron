/**
 * Wraps `next build`, temporarily removing routes the counter (desktop) build has no
 * use for, so they neither compile into the standalone server nor get preloaded /
 * warmed at boot.
 *
 * Why a rename-out-and-back wrapper instead of deleting the source: the exact same
 * `src/app` tree also builds the Vercel/web app, where these routes are real
 * (customer storefront, portal, legal pages, sitemap/robots). Renaming them out of
 * `src/app`'s route-file naming convention for the duration of `next build` only,
 * then restoring in a `finally`, keeps one source tree serving both builds without a
 * manual revert step.
 *
 * Renames individual route-convention files (page.tsx, route.ts, ...) rather than
 * their containing directories: Next's App Router only turns a directory into a
 * route via those specific filenames, so renaming just the files is enough to drop
 * the route, and it sidesteps a real Windows issue — an editor's file watcher can
 * hold a directory handle open (without FILE_SHARE_DELETE) and make a *directory*
 * rename fail with EPERM, even though nothing is actually being written. Individual
 * file renames underneath were not affected by the same lock (verified against
 * `src/app/(external)` with an editor open).
 *
 * No-op (plain `next build`) unless COUNTER_BUILD=1 — the Vercel build must stay
 * byte-identical to what it has always produced. See next.config.ts's own
 * COUNTER_BUILD gate.
 *
 * Excluded for COUNTER_BUILD:
 * - `src/app/(external)/**` route files — the customer storefront, portal, and legal
 *   pages. Staff log in manually at /staff/login; the counter build never routes
 *   there. (Firebase, used only by the portal's passwordless auth, is pulled in
 *   transitively and drops out of the server bundle once nothing imports it.)
 * - `src/app/robots.ts`, `src/app/sitemap.ts` — SEO surface with no meaning on a
 *   till that isn't crawled.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const COUNTER_BUILD = process.env.COUNTER_BUILD === "1";

const APP_DIR = path.join(__dirname, "..", "src", "app");
const EXTERNAL_DIR = path.join(APP_DIR, "(external)");

// Next's App Router file-convention names (any of these extensions) that turn a file
// into a route. https://nextjs.org/docs/app/api-reference/file-conventions
const ROUTE_CONVENTION_BASENAMES = new Set([
    "page", "layout", "route", "loading", "error", "not-found", "global-error",
    "template", "default", "opengraph-image", "twitter-image", "icon", "apple-icon",
]);
const ROUTE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

function isRouteConventionFile(fileName: string): boolean {
    const ext = ROUTE_EXTENSIONS.find((e) => fileName.endsWith(e));
    if (!ext) return false;
    // Strip a trailing numeric parallel-route/variant suffix if present isn't needed here —
    // these are plain basenames like "page.tsx", not "page@modal.tsx".
    return ROUTE_CONVENTION_BASENAMES.has(fileName.slice(0, -ext.length));
}

function findRouteFiles(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            findRouteFiles(full, out);
        } else if (entry.isFile() && isRouteConventionFile(entry.name)) {
            out.push(full);
        }
    }
}

/** Synchronous sleep — fine here, this is a one-shot build script, not a server. */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A watcher (editor, antivirus) can momentarily hold even a single file open without
 * FILE_SHARE_DELETE, tripping rename with EPERM/EBUSY. That's normally released
 * within a moment, so retry a few times before treating it as a real failure.
 */
function renameWithRetry(from: string, to: string): void {
    const attempts = 10;
    for (let i = 1; i <= attempts; i++) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (err) {
            const isLocked = (err as NodeJS.ErrnoException).code === "EPERM" || (err as NodeJS.ErrnoException).code === "EBUSY";
            if (!isLocked || i === attempts) throw err;
            sleepSync(200);
        }
    }
}

function run(): void {
    execFileSync("node", [require.resolve("next/dist/bin/next"), "build"], {
        stdio: "inherit",
        cwd: path.join(__dirname, ".."),
    });
}

if (!COUNTER_BUILD) {
    run();
    process.exit(0);
}

const toExclude: string[] = [];
if (fs.existsSync(EXTERNAL_DIR)) findRouteFiles(EXTERNAL_DIR, toExclude);
for (const rel of ["robots.ts", "sitemap.ts"]) {
    const full = path.join(APP_DIR, rel);
    if (fs.existsSync(full)) toExclude.push(full);
}

const moved: Array<{ from: string; to: string }> = [];
for (const from of toExclude) {
    const to = from + ".counter-build-excluded";
    renameWithRetry(from, to);
    moved.push({ from, to });
}
console.log(`[counter-build] Excluded ${moved.length} route file(s) under (external)/, robots.ts, sitemap.ts from this build.`);

try {
    run();
} finally {
    // Always restore, even if `next build` throws — leaving src/app permanently
    // missing these routes would silently break the next Vercel build.
    for (const { from, to } of moved) {
        renameWithRetry(to, from);
    }
    if (moved.length > 0) {
        console.log("[counter-build] Restored excluded routes.");
    }
}
