import * as fs from "fs";
import * as path from "path";
import { hoistNodeModules, findSymlinks, listPackages, containingNodeModules, isDirectory } from "./lib/hoistNodeModules";

/** Extensions to skip when copying public/ — large binaries that bloat the app. */
const SKIP_EXTENSIONS = new Set([".exe", ".zip"]);

/**
 * Flattens `.next/standalone/node_modules` from pnpm's symlink layout into a real
 * directory tree.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * With pnpm, `next build` leaves the traced dependencies as ABSOLUTE symlinks into
 * the pnpm store:
 *
 *   node_modules/next -> D:/.../node_modules/.pnpm/next@16.2.6_.../node_modules/next
 *
 * electron-builder does not dereference those when it copies `extraResources`, so the
 * packaged app shipped a `standalone/` with no usable `node_modules` at all. Since
 * `standalone/server.js` does `require('next')` — resolved against its OWN directory —
 * the Next server never booted and the window showed ERR_CONNECTION_REFUSED. Pointing
 * NODE_PATH at other folders cannot fix it either: once `next` loads, its own
 * transitive requires resolve relative to `next`'s location, not NODE_PATH.
 *
 * ── Why flat ────────────────────────────────────────────────────────────────
 * Node resolution walks UP the directory chain, so one flat top-level folder satisfies
 * every package's requires. Flattening also sidesteps pnpm's cyclic store (A's deps
 * link to B, B's link back to A) — a naive dereferencing copy of that graph never
 * terminates. We instead walk the graph once with a `visited` set of resolved paths.
 *
 * `extraSeeds` are additional `node_modules` directories to start the walk from — see
 * `dereferenceServerExternals`, which supplies the store folders behind Next's
 * server-externalised packages so their dependencies land here too.
 */
/**
 * Build-only tools that end up reachable through the pnpm store walk despite never
 * being `require()`d by `server.js` at runtime — measured at ~130 MB combined in the
 * 2026-08-24 size audit (`prisma` CLI 40 MB, `typescript` 22.5 MB, `playwright`/
 * `playwright-core` 16.6 MB, `@babel/*` and `fast-check` the rest). Keeping this list
 * small and explicit (rather than "prune everything not in package.json dependencies")
 * means a genuine runtime need only ever has to be un-denied, never silently dropped.
 */
const STANDALONE_DENYLIST_NAMES = new Set(["prisma", "typescript", "playwright", "playwright-core", "fast-check"]);

/**
 * Two more families that reach this tree through `next`'s OPTIONAL dependencies rather
 * than through anything `server.js` requires. The pnpm store walk picks them up because
 * it copies whole packages; Next's own tracing never asks for either.
 *
 * `@next/swc-*` is the Rust build compiler — 130 MB in a single file, the largest thing
 * in the installer. Its only server-side reference is `next/dist/server/config.js`,
 * behind `experimental.useLightningcss`, which we never set; standalone `server.js`
 * passes `__NEXT_PRIVATE_STANDALONE_CONFIG` and skips that path regardless. Matched by
 * PREFIX, not by one triple, so a build host on another platform cannot smuggle a
 * different 100 MB binary in.
 *
 * `sharp` / `@img/*` is Next's image optimiser, dead here only while the build keeps
 * `images.unoptimized` — hence the flag rather than a flat deny (see imagesUnoptimized).
 * hardware-bridge ships its own copy for QR rendering; that is a separate tree, staged by
 * prepare-bridge-deps.ts, and nothing here touches it.
 */
const isBuildOnlyBinary = (name: string) => name.startsWith("@next/swc-");
const isImageOptimiser = (name: string) => name === "sharp" || name.startsWith("@img/");

const makeStandaloneDenylist = (dropImageOptimiser: boolean) => (name: string) =>
    STANDALONE_DENYLIST_NAMES.has(name) ||
    name.startsWith("@babel/") ||
    isBuildOnlyBinary(name) ||
    (dropImageOptimiser && isImageOptimiser(name));

/**
 * Type declarations and source maps. Never read at runtime, present in nearly every
 * package, and stripped from BOTH copy paths — the hoist below and the externals copy in
 * dereferenceServerExternals, which does its own cpSync and would otherwise keep them.
 */
const STRIP_SUFFIXES = [".d.ts", ".d.mts", ".map"];
const isStrippable = (file: string) => STRIP_SUFFIXES.some((suffix) => file.endsWith(suffix));

/**
 * Does this build still skip Next's image optimiser?
 *
 * Read from the BUILT `required-server-files.json` rather than next.config.ts, because
 * that is the config the packaged server actually runs on. A missing or false flag means
 * sharp is load-bearing again, so the deny must not fire — fail safe, and say so.
 */
function imagesUnoptimized(standaloneDir: string): boolean {
    try {
        const file = path.join(standaloneDir, ".next", "required-server-files.json");
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
            config?: { images?: { unoptimized?: boolean; loader?: string } };
        };
        // A custom loader never routes through /_next/image either.
        return parsed.config?.images?.unoptimized === true || parsed.config?.images?.loader === "custom";
    } catch {
        return false;
    }
}

function hoistStandaloneDeps(standaloneDir: string, extraSeeds: string[] = [], dropImageOptimiser = false): void {
    const nodeModulesDir = path.join(standaloneDir, "node_modules");
    if (!fs.existsSync(nodeModulesDir)) {
        console.warn("[prepare-standalone] No standalone/node_modules to hoist — skipping.");
        return;
    }
    const count = hoistNodeModules(nodeModulesDir, [nodeModulesDir, ...extraSeeds], {
        denylist: makeStandaloneDenylist(dropImageOptimiser),
        stripSuffixes: STRIP_SUFFIXES,
    });
    console.log(`[prepare-standalone] Hoisted ${count} packages into standalone/node_modules.`);
}

/**
 * Materialises Next's server-externalised packages, and reports where their
 * dependencies live.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `standalone/node_modules` is not the only place `next build` puts dependencies.
 * Packages it externalises for the server go to a second directory:
 *
 *   .next/standalone/.next/node_modules/@prisma/client-403e33a7f81c97d6
 *   .next/standalone/.next/node_modules/pg-63e85fc611dc39f8
 *
 * (the suffix is a content hash) and under pnpm those are absolute symlinks into the
 * store, exactly like the ones `hoistStandaloneDeps` was written for — in a directory
 * it never walked. electron-builder copies them as links, so `--dir` output carries
 * five paths that dangle on any machine without this pnpm store. The NSIS installer
 * happens to dereference them on install, which is why the bug hid: the packaged tree
 * was broken while the installed tree looked fine.
 *
 * The return value matters as much as the copy. `@prisma/client` declares exactly one
 * dependency, `@prisma/client-runtime-utils`, and pnpm keeps it as a SIBLING of the
 * real package rather than inside it — so materialising the link alone ships a package
 * whose very first require fails. That threw
 * "Cannot find module '@prisma/client-runtime-utils'" out of instrumentation.js at
 * server start, which the browser showed as `Internal Server Error` on every page.
 * Returning each link's containing store folder lets the hoist walk pull those
 * siblings into the flat tree, where Node's upward resolution finds them.
 */
function dereferenceServerExternals(standaloneDir: string): string[] {
    const externalsDir = path.join(standaloneDir, ".next", "node_modules");
    if (!isDirectory(externalsDir)) return [];

    const seeds: string[] = [];
    let materialised = 0;

    for (const pkg of listPackages(externalsDir)) {
        let real: string;
        try {
            real = fs.realpathSync(pkg.path);
        } catch {
            // Dangling link into a store that no longer exists — nothing to copy.
            continue;
        }

        // Collect the dependency folder BEFORE replacing the link: once the package is
        // a real directory here, its container is this externals folder, not the store.
        const sibling = containingNodeModules(real);
        if (sibling) {
            seeds.push(sibling);
            // Next's trace copies into standalone's own `.pnpm` only the files it saw
            // required, so a dependency loaded behind a hook (import-in-the-middle's
            // `acorn`, `cjs-module-lexer`) can be missing there. The project's pnpm store
            // holds the same folder complete — seed from it too.
            const standaloneStore = path.join(standaloneDir, "node_modules", ".pnpm") + path.sep;
            if (sibling.startsWith(standaloneStore)) {
                const projectSibling = path.join(process.cwd(), "node_modules", ".pnpm", sibling.slice(standaloneStore.length));
                if (isDirectory(projectSibling)) seeds.push(projectSibling);
            }
        }

        if (!fs.lstatSync(pkg.path).isSymbolicLink()) continue;

        // rmSync does not follow symlinks — it unlinks this entry and leaves the store
        // untouched. (unlinkSync would be clearer but fails on Windows junctions, which
        // is what pnpm creates here.)
        fs.rmSync(pkg.path, { recursive: true, force: true });
        fs.cpSync(real, pkg.path, {
            recursive: true,
            dereference: true,
            // Its dependencies come from the flat standalone/node_modules instead:
            // Node's resolution walks up from here and finds them there.
            filter: (src) => path.basename(src) !== "node_modules" && !isStrippable(src),
        });
        materialised++;
    }

    if (materialised > 0) {
        console.log(
            `[prepare-standalone] Materialised ${materialised} server-externalised packages in standalone/.next/node_modules.`
        );
    }
    return seeds;
}

/** Every byte under `dir`, for the build log. */
function dirSizeSync(dir: string): number {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += dirSizeSync(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
    }
    return total;
}

/**
 * Deletes payload that survives the hoist but is never read on a counter.
 *
 * Both items live INSIDE packages we genuinely need, so the package-level denylist
 * cannot reach them, and `stripSuffixes` is a global unscoped suffix match — wrong tool
 * for either. This is a scoped pass instead, run after the hoist so it also catches the
 * second copy that `dereferenceServerExternals` materialises outside the hoister.
 *
 *  · Prisma ships a WASM query compiler per database engine, in two size variants and
 *    two module formats — ~56 MB per copy, and this tree carries two copies. The provider
 *    is fixed at generate time (src/generated/prisma/internal/class.ts imports
 *    `query_compiler_fast_bg.postgresql.mjs` by name), so nothing dispatches at runtime
 *    and the other four engines are unreachable.
 *  · `next/dist/docs` is 421 markdown files a production server never opens.
 *
 * The prune matches by filename, so a Prisma rename could silently take the postgresql
 * compiler too and every query on every counter would fail. Each runtime folder that had
 * compilers must therefore still have a postgresql one afterwards, or the build stops.
 */
const PRISMA_COMPILER_PREFIX = "query_compiler_";
const PRISMA_KEEP_PROVIDER = ".postgresql.";

function pruneUnusedPayload(standaloneDir: string): number {
    let freed = 0;

    // Both trees: the hoisted one, and the externalised one whose package directories
    // carry a content-hash suffix (@prisma/client-403e33a7f81c97d6).
    const roots = [path.join(standaloneDir, "node_modules"), path.join(standaloneDir, ".next", "node_modules")];

    for (const root of roots) {
        const scope = path.join(root, "@prisma");
        if (!isDirectory(scope)) continue;

        for (const pkg of fs.readdirSync(scope)) {
            const runtime = path.join(scope, pkg, "runtime");
            if (!isDirectory(runtime)) continue;

            let sawCompilers = false;
            let keptPostgres = false;
            for (const file of fs.readdirSync(runtime)) {
                if (!file.startsWith(PRISMA_COMPILER_PREFIX)) continue;
                sawCompilers = true;
                if (file.includes(PRISMA_KEEP_PROVIDER)) {
                    keptPostgres = true;
                    continue;
                }
                const full = path.join(runtime, file);
                freed += fs.statSync(full).size;
                fs.rmSync(full, { force: true });
            }

            if (sawCompilers && !keptPostgres) {
                console.error(
                    `[prepare-standalone] FATAL: pruned every query compiler out of @prisma/${pkg}/runtime.
` +
                    `  Nothing matching "${PRISMA_KEEP_PROVIDER}" was left, so Prisma has probably renamed these
` +
                    "  files. Check the names in that folder and update PRISMA_KEEP_PROVIDER before packaging."
                );
                process.exit(1);
            }
        }
    }

    const docs = path.join(standaloneDir, "node_modules", "next", "dist", "docs");
    if (isDirectory(docs)) {
        freed += dirSizeSync(docs);
        fs.rmSync(docs, { recursive: true, force: true });
    }

    return freed;
}

function copyFolderSync(from: string, to: string): void {
    if (!fs.existsSync(from)) return;
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }
    const entries = fs.readdirSync(from, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (SKIP_EXTENSIONS.has(ext)) {
                console.log(`[prepare-standalone] Skipping ${entry.name} (${ext})`);
                continue;
            }
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    const rootDir = process.cwd();
    const standaloneDir = path.join(rootDir, ".next", "standalone");
    const staticDir = path.join(rootDir, ".next", "static");
    const publicDir = path.join(rootDir, "public");

    if (!fs.existsSync(standaloneDir)) {
        console.warn("[prepare-standalone] .next/standalone does not exist yet. Run 'COUNTER_BUILD=1 pnpm build' first.");
        return;
    }

    console.log("[prepare-standalone] Copying .next/static into .next/standalone/.next/static...");
    copyFolderSync(staticDir, path.join(standaloneDir, ".next", "static"));

    console.log("[prepare-standalone] Copying public into .next/standalone/public (skipping .exe/.zip)...");
    copyFolderSync(publicDir, path.join(standaloneDir, "public"));

    console.log("[prepare-standalone] Materialising Next's server-externalised packages...");
    const externalSeeds = dereferenceServerExternals(standaloneDir);

    // Our own server code (campaigns' postPhotoFit) imports sharp, which Next then
    // externalises into .next/node_modules — its @img/* deps must ship too.
    const appUsesSharp = listPackages(path.join(standaloneDir, ".next", "node_modules")).some((pkg) =>
        path.basename(pkg.path).startsWith("sharp")
    );
    const dropImageOptimiser = imagesUnoptimized(standaloneDir) && !appUsesSharp;
    if (!dropImageOptimiser) {
        console.log("[prepare-standalone] sharp is load-bearing (image optimiser or app code) — keeping sharp and @img/*.");
    }

    console.log("[prepare-standalone] Hoisting pnpm-symlinked dependencies into real directories...");
    hoistStandaloneDeps(standaloneDir, externalSeeds, dropImageOptimiser);

    const freedMb = pruneUnusedPayload(standaloneDir) / (1024 * 1024);
    console.log(`[prepare-standalone] Pruned ${freedMb.toFixed(1)} MB the counter never reads (unused Prisma engines, Next docs).`);

    // `next build` copies the build-machine .env into the standalone output. That file
    // holds production Supabase, payment-gateway and Dropbox credentials, so it must
    // never reach a shop PC. electron-builder's extraResources filter also excludes it;
    // deleting it here means a later edit to that filter cannot silently leak it.
    // Counters get their credentials from %APPDATA%/abeersuite-electron/.env instead.
    for (const entry of fs.readdirSync(standaloneDir)) {
        if (entry === ".env" || entry.startsWith(".env.")) {
            fs.rmSync(path.join(standaloneDir, entry), { force: true });
            console.log(`[prepare-standalone] Removed ${entry} from standalone output (never ship secrets).`);
        }
    }

    // The build must not proceed on a standalone folder the packaged app cannot run.
    // Everything downstream (electron-builder, the installer) succeeds regardless, so
    // without this check a broken bundle only surfaces as a blank window on a shop PC.
    //
    // This proves the folder ON DISK is complete — it does NOT prove the folder made it
    // into the installer. electron-builder drops a top-level `node_modules` from an
    // `extraResources` root whatever filter you give it, which is why package.json copies
    // `.next/standalone/node_modules` as its own entry. `scripts/verify-package.ts` is the
    // check that guards the packaged tree; this one guards the build inputs.
    //
    // `next` and `react` are top-level entries, so they survive even a shallow hoist.
    // `@next/env` and `styled-jsx` are reachable only through next's own dependency
    // list — they are the canaries that prove the transitive walk actually ran.
    // `@prisma/client-runtime-utils` is the canary for `dereferenceServerExternals`:
    // it is reachable ONLY as a pnpm sibling of the externalised `@prisma/client`, so
    // its absence means the externals seeding did not run and the packaged server will
    // answer `Internal Server Error` on every page.
    const required = ["next", "react", "react-dom", "@next/env", "styled-jsx", "@prisma/client-runtime-utils"];
    const nodeModulesDir = path.join(standaloneDir, "node_modules");
    for (const name of required) {
        const pkgJson = path.join(nodeModulesDir, name, "package.json");
        if (!fs.existsSync(pkgJson)) {
            console.error(
                `[prepare-standalone] FATAL: standalone/node_modules/${name}/package.json is missing.\n` +
                "  standalone/server.js loads next at startup and will fail without it.\n" +
                "  Run `pnpm install` and rebuild before packaging."
            );
            process.exit(1);
        }
        if (fs.lstatSync(path.join(nodeModulesDir, name)).isSymbolicLink()) {
            console.error(
                `[prepare-standalone] FATAL: standalone/node_modules/${name} is still a symlink.\n` +
                "  electron-builder will drop it and the packaged server will not start."
            );
            process.exit(1);
        }
    }

    // Generic backstop for the two checks above: ANY symlink left in this tree points
    // into this machine's pnpm store and will dangle on a shop PC. The named canaries
    // only cover the packages we thought of; this covers the next directory Next
    // invents. Both bugs so far were symlinks in a folder nobody was looking at.
    const leftoverLinks = findSymlinks(standaloneDir);
    if (leftoverLinks.length > 0) {
        console.error(
            `[prepare-standalone] FATAL: ${leftoverLinks.length} symlink(s) remain under .next/standalone.\n` +
            "  Each one points into this machine's pnpm store and will dangle elsewhere:\n" +
            leftoverLinks.slice(0, 20).map((p) => `    ${p}`).join("\n") +
            (leftoverLinks.length > 20 ? `\n    ...and ${leftoverLinks.length - 20} more` : "")
        );
        process.exit(1);
    }

    console.log("[prepare-standalone] Standalone directory prepared successfully!");
}

main().catch(console.error);
