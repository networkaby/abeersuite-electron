/**
 * Wraps `next build`, temporarily removing routes the desktop (`office`/`counter`)
 * build has no use for, so they neither compile into the standalone server nor get
 * preloaded / warmed at boot.
 *
 * Why a rename-out-and-back wrapper instead of deleting the source: the exact same
 * `src/app` tree also builds the Vercel/web app, and `electron:build` runs in a
 * developer's REAL local checkout — not a throwaway clone like Vercel gives
 * `strip-build.ts`'s `public` mode. Deleting files here would eat someone's working
 * tree on a failed or misconfigured build. Renaming route-convention files out of
 * `src/app`'s naming convention for the duration of `next build` only, then restoring
 * in a `finally`, keeps one source tree serving every build variant with no manual
 * revert step and nothing permanently lost if the process is killed mid-build (the
 * `finally` still runs; a hard crash leaves `.counter-build-excluded` files that the
 * NEXT run's restore-on-start pass below cleans up).
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
 * What gets excluded depends on APP_MODE (`office` or `counter` — the two variants
 * `electron:build` produces; see `src/shared/lib/appModeCore.ts` for the mode
 * contract):
 * - Both exclude `src/app/(external)/**`, `robots.ts`, `sitemap.ts` — the customer
 *   storefront, portal, legal pages, and SEO surface. Staff log in manually at
 *   /staff/login; neither desktop variant routes there. (Firebase, used only by the
 *   portal's passwordless auth, is pulled in transitively and drops out of the server
 *   bundle once nothing imports it.)
 * - `counter` additionally excludes the office/vouchers modules a till has no use for,
 *   and narrows `src/app/api` to `COUNTER_API_ALLOWLIST` — see appModeCore.ts for why
 *   that list is a first pass, expected to be iterated against a real build.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
    parseAppMode,
    modeFlags,
    PUBLIC_ONLY_APP_DIRS,
    PUBLIC_ONLY_APP_FILES,
    PUBLIC_ONLY_API_SEGMENTS,
    COUNTER_OFFICE_MODULE_STRIP,
    COUNTER_VOUCHERS_MODULE_STRIP,
    COUNTER_SETTINGS_KEEP,
    COUNTER_API_ALLOWLIST,
} from "../src/shared/lib/appModeCore";

const COUNTER_BUILD = process.env.COUNTER_BUILD === "1";
const mode = parseAppMode(process.env.APP_MODE);
const flags = modeFlags(mode);

const APP_DIR = path.join(__dirname, "..", "src", "app");
const API_DIR = path.join(APP_DIR, "api");
const EXCLUDED_SUFFIX = ".counter-build-excluded";

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
    return ROUTE_CONVENTION_BASENAMES.has(fileName.slice(0, -ext.length));
}

function findRouteFiles(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
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

/**
 * A previous run that was killed (Ctrl+C, crash) mid-build can leave route files
 * renamed out and never restored. Sweep for `.counter-build-excluded` leftovers and
 * restore them before doing anything else, so this run starts from a clean tree
 * instead of compounding an old failure.
 */
function restoreOrphans(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            restoreOrphans(full);
        } else if (entry.isFile() && entry.name.endsWith(EXCLUDED_SUFFIX)) {
            const restored = full.slice(0, -EXCLUDED_SUFFIX.length);
            console.warn(`[counter-build] Restoring orphaned exclusion from a previous run: ${path.relative(APP_DIR, restored)}`);
            renameWithRetry(full, restored);
        }
    }
}

function run(): void {
    // A prior `next dev` run leaves `.next/dev/types` with a route set generated
    // from the FULL app tree (before any exclusion above). tsconfig.json includes
    // both `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` in the same compile,
    // so if a route excluded above (e.g. `/portal`) is still present in that stale
    // dev-mode LayoutRoutes, `next build`'s typecheck fails with a "not assignable"
    // constraint error comparing the two. Drop it so the build only typechecks
    // against the route set it just generated; `next dev` regenerates it on its own.
    const devTypesDir = path.join(__dirname, "..", ".next", "dev", "types");
    if (fs.existsSync(devTypesDir)) {
        fs.rmSync(devTypesDir, { recursive: true, force: true });
    }
    execFileSync("node", [require.resolve("next/dist/bin/next"), "build"], {
        stdio: "inherit",
        cwd: path.join(__dirname, ".."),
    });
}

restoreOrphans(APP_DIR);

if (!COUNTER_BUILD) {
    run();
    process.exit(0);
}

const toExcludeFiles: string[] = [];

function removeApiSegment(segment: string): void {
    findRouteFiles(path.join(API_DIR, segment), toExcludeFiles);
}

// `full` built through the electron chain (COUNTER_BUILD=1) keeps everything — nothing
// to exclude. In practice only `office` and `counter` are built this way.
if (!flags.hasPublicRoutes) {
    for (const dir of PUBLIC_ONLY_APP_DIRS) findRouteFiles(path.join(APP_DIR, dir), toExcludeFiles);
    for (const rel of PUBLIC_ONLY_APP_FILES) {
        const full = path.join(APP_DIR, rel);
        if (fs.existsSync(full)) toExcludeFiles.push(full);
    }
    for (const segment of PUBLIC_ONLY_API_SEGMENTS) {
        removeApiSegment(segment);
    }
}

if (flags.isCounter) {
    for (const rel of [...COUNTER_OFFICE_MODULE_STRIP, ...COUNTER_VOUCHERS_MODULE_STRIP]) {
        findRouteFiles(path.join(APP_DIR, "(protected)", ...rel.split("/")), toExcludeFiles);
    }
    // office/settings keeps only the till-relevant sub-pages (see COUNTER_SETTINGS_KEEP).
    const settingsDir = path.join(APP_DIR, "(protected)", "office", "settings");
    if (fs.existsSync(settingsDir)) {
        for (const entry of fs.readdirSync(settingsDir, { withFileTypes: true })) {
            if (entry.isDirectory() && !COUNTER_SETTINGS_KEEP.has(entry.name)) {
                findRouteFiles(path.join(settingsDir, entry.name), toExcludeFiles);
            }
        }
    }
    if (fs.existsSync(API_DIR)) {
        for (const entry of fs.readdirSync(API_DIR, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (COUNTER_API_ALLOWLIST.has(entry.name)) continue;
            if (PUBLIC_ONLY_API_SEGMENTS.has(entry.name)) continue; // already queued above
            removeApiSegment(entry.name);
        }
    }
}

const moved: Array<{ from: string; to: string }> = [];
for (const from of toExcludeFiles) {
    const to = from + EXCLUDED_SUFFIX;
    renameWithRetry(from, to);
    moved.push({ from, to });
}
console.log(`[counter-build] APP_MODE=${mode} — excluded ${moved.length} route file(s) for the duration of this build.`);

try {
    run();
} finally {
    // Always restore, even if `next build` throws — leaving src/app permanently
    // missing these routes would silently break the next build of any other variant.
    for (const { from, to } of moved) {
        renameWithRetry(to, from);
    }
    if (moved.length > 0) {
        console.log("[counter-build] Restored excluded routes.");
    }
}
