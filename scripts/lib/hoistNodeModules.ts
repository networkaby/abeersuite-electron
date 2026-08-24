import * as fs from "fs";
import * as path from "path";

/**
 * Flattens one or more pnpm-symlinked `node_modules` directories into a single real
 * directory tree at `destDir`.
 *
 * Extracted from `prepare-standalone.ts` (see that file for the full rationale — pnpm's
 * absolute store symlinks, why the tree must be flat, why the walk needs a realpath
 * `visited` set to terminate on the store's cyclic layout) so a second, much smaller
 * caller (`prepare-electron-deps.ts`) can reuse the same tested walk instead of
 * re-deriving it.
 *
 * Safe even when `destDir` is itself among `seedNodeModulesDirs` (the common case —
 * flattening a directory in place): packages are copied into a scratch directory next
 * to `destDir` and swapped in only once the whole walk finishes, so a partial run never
 * leaves `destDir` half-real, half-symlink.
 *
 * `denylist` skips a package by name entirely — its own files are not copied and its
 * dependency tree is not walked, for build-only tools (`prisma`, `typescript`,
 * `playwright`) that end up reachable through the pnpm store walk despite never being
 * `require()`d at runtime. A predicate rather than a fixed set so a caller can match a
 * whole scope (e.g. every `@babel/*` package) without enumerating each one. `stripSuffixes`
 * drops matching files from every package that IS copied (e.g. `.map`, `.d.ts` — useful
 * for source maps and type declarations, neither of which a running server or Electron
 * process reads). Matched by suffix, not `path.extname`, because `.d.ts` is two dots
 * and `extname` would only see `.ts`.
 */
export function hoistNodeModules(
    destDir: string,
    seedNodeModulesDirs: string[],
    options: { denylist?: (packageName: string) => boolean; stripSuffixes?: readonly string[] } = {},
): number {
    const { denylist, stripSuffixes } = options;
    const outDir = `${destDir}.hoisted`;
    fs.rmSync(outDir, { recursive: true, force: true });

    /** Resolved realpaths already walked — the cycle guard. */
    const visited = new Set<string>();
    /** Package name -> realpath it was copied from, for conflict reporting. */
    const placed = new Map<string, string>();
    const queue: string[] = [...seedNodeModulesDirs];

    while (queue.length > 0) {
        const dir = queue.shift()!;
        for (const pkg of listPackages(dir)) {
            if (denylist?.(pkg.name)) continue;

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
                console.warn(`[hoistNodeModules] Version conflict for "${pkg.name}" — keeping ${existing}, ignoring ${real}`);
            } else if (!existing) {
                placed.set(pkg.name, real);
                const dest = path.join(outDir, pkg.name);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.cpSync(real, dest, {
                    recursive: true,
                    dereference: true,
                    filter: (src) => {
                        // Nested dep trees are hoisted separately via the queue below.
                        if (path.basename(src) === "node_modules") return false;
                        if (stripSuffixes?.some((suffix) => src.endsWith(suffix))) return false;
                        return true;
                    },
                });
            }

            const nested = path.join(real, "node_modules");
            if (isDirectory(nested)) queue.push(nested);

            // pnpm puts a package's dependencies as SIBLINGS of the real package rather
            // than inside it, so the dep list of `real` is the node_modules folder that
            // CONTAINS it, not one inside it.
            const sibling = containingNodeModules(real);
            if (sibling) queue.push(sibling);
        }
    }

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(outDir, destDir);
    return placed.size;
}

/** Every symlink under `dir`, recursively. Returns paths relative to `dir`. */
export function findSymlinks(dir: string, base = dir): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            out.push(path.relative(base, full));
        } else if (entry.isDirectory()) {
            out.push(...findSymlinks(full, base));
        }
    }
    return out;
}

/**
 * Lists the package entries directly inside a `node_modules` directory, expanding
 * `@scope` folders one level so the returned name is the real package name.
 *
 * Skips `.pnpm` and `.bin`: `.pnpm` entry names are store keys
 * (`next@16.2.6_<hash>`), not package names, and everything inside it is reachable by
 * following the symlinks we already walk.
 */
export function listPackages(dir: string): Array<{ name: string; path: string }> {
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
export function containingNodeModules(real: string): string | null {
    let dir = path.dirname(real);
    // For `@scope/name` the immediate parent is the scope folder, not node_modules.
    if (path.basename(dir).startsWith("@")) dir = path.dirname(dir);
    return path.basename(dir) === "node_modules" ? dir : null;
}

/** True when the path exists and is a directory, following symlinks. */
export function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}
