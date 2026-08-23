import * as fs from "fs";
import * as path from "path";

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
 */
function hoistStandaloneDeps(standaloneDir: string): void {
    const nodeModulesDir = path.join(standaloneDir, "node_modules");
    if (!fs.existsSync(nodeModulesDir)) {
        console.warn("[prepare-standalone] No standalone/node_modules to hoist — skipping.");
        return;
    }

    // Build alongside the original: the real packages we are reading live inside the
    // very folder we are replacing, so we cannot write into it as we go.
    const outDir = path.join(standaloneDir, "node_modules.hoisted");
    fs.rmSync(outDir, { recursive: true, force: true });

    /** Resolved realpaths already walked — the cycle guard. */
    const visited = new Set<string>();
    /** Package name -> realpath it was copied from, for conflict reporting. */
    const placed = new Map<string, string>();
    /** `node_modules` directories still to scan. */
    const queue: string[] = [nodeModulesDir];

    while (queue.length > 0) {
        const dir = queue.shift()!;
        for (const pkg of listPackages(dir)) {
            let real: string;
            try {
                real = fs.realpathSync(pkg.path);
            } catch {
                // Dangling link into a store that no longer exists — nothing to copy.
                continue;
            }
            if (visited.has(real)) continue;
            visited.add(real);

            const existing = placed.get(pkg.name);
            if (existing && existing !== real) {
                // Two versions of one package. A traced production set rarely has these;
                // log rather than fail so the build still produces something testable.
                console.warn(
                    `[prepare-standalone] Version conflict for "${pkg.name}" — keeping ${existing}, ignoring ${real}`
                );
            } else if (!existing) {
                placed.set(pkg.name, real);
                const dest = path.join(outDir, pkg.name);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.cpSync(real, dest, {
                    recursive: true,
                    dereference: true,
                    // Nested dep trees are hoisted separately via the queue below.
                    filter: (src) => path.basename(src) !== "node_modules",
                });
            }

            const nested = path.join(real, "node_modules");
            if (isDirectory(nested)) queue.push(nested);

            // pnpm puts a package's dependencies as SIBLINGS of the real package rather
            // than inside it:  .pnpm/pg@8.20.0/node_modules/{pg, pg-pool -> ..., pgpass -> ...}
            // so the dep list of `real` is the node_modules folder that CONTAINS it.
            const sibling = containingNodeModules(real);
            if (sibling) queue.push(sibling);
        }
    }

    fs.rmSync(nodeModulesDir, { recursive: true, force: true });
    fs.renameSync(outDir, nodeModulesDir);
    console.log(`[prepare-standalone] Hoisted ${placed.size} packages into standalone/node_modules.`);
}

/**
 * Lists the package entries directly inside a `node_modules` directory, expanding
 * `@scope` folders one level so the returned name is the real package name.
 *
 * Skips `.pnpm` and `.bin`: `.pnpm` entry names are store keys
 * (`next@16.2.6_<hash>`), not package names, and everything inside it is reachable by
 * following the symlinks we already walk.
 */
function listPackages(dir: string): Array<{ name: string; path: string }> {
    const out: Array<{ name: string; path: string }> = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name.startsWith("@")) {
            const scopeDir = path.join(dir, entry.name);
            for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
                if (scoped.name.startsWith(".")) continue;
                out.push({ name: `${entry.name}/${scoped.name}`, path: path.join(scopeDir, scoped.name) });
            }
            continue;
        }
        out.push({ name: entry.name, path: path.join(dir, entry.name) });
    }
    return out;
}

/**
 * Returns the `node_modules` directory that CONTAINS the given real package path,
 * or null if the path does not sit inside one.
 *
 * In the pnpm store a package's dependency list is its own containing folder:
 *
 *   .pnpm/pg@8.20.0/node_modules/pg          <- the real package
 *   .pnpm/pg@8.20.0/node_modules/pg-pool     <- symlink, a dependency OF pg
 *
 * so scanning `<real>/node_modules` alone finds nothing and the walk stops at depth 1.
 */
function containingNodeModules(real: string): string | null {
    let dir = path.dirname(real);
    // For `@scope/name` the immediate parent is the scope folder, not node_modules.
    if (path.basename(dir).startsWith("@")) dir = path.dirname(dir);
    return path.basename(dir) === "node_modules" ? dir : null;
}

/** True when the path exists and is a directory, following symlinks. */
function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
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

    console.log("[prepare-standalone] Hoisting pnpm-symlinked dependencies into real directories...");
    hoistStandaloneDeps(standaloneDir);

    // `next build` copies the build-machine .env into the standalone output. That file
    // holds production Supabase, payment-gateway and Dropbox credentials, so it must
    // never reach a shop PC. electron-builder's extraResources filter also excludes it;
    // deleting it here means a later edit to that filter cannot silently leak it.
    // Counters get their credentials from %APPDATA%/AbeerSuite/.env instead.
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
    const required = ["next", "react", "react-dom", "@next/env", "styled-jsx"];
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

    console.log("[prepare-standalone] Standalone directory prepared successfully!");
}

main().catch(console.error);
