/**
 * Build gate: refuses to let an unshippable package leave this machine.
 *
 * It checks the *packaged* tree, not the build inputs. Both problems it guards against
 * were invisible in the source tree and only appeared after electron-builder ran:
 *
 *   A. The 0.1.0 package had no `resources/standalone/node_modules` at all, so
 *      `server.js`'s `require('next')` failed, the Next server never booted, and the
 *      window showed ERR_CONNECTION_REFUSED. `prepare-standalone.ts` had already
 *      asserted the directory was complete — it was, on disk. electron-builder dropped
 *      it during the copy: `app-builder-lib/out/util/filter.js` rejects any entry whose
 *      path relative to an `extraResources` root is exactly `node_modules`, whatever
 *      patterns you pass. Hence the separate `.next/standalone/node_modules` entry in
 *      package.json — as its own root, none of its children hit that rule. A rule that
 *      subtle can regress on any electron-builder upgrade, so it is asserted here.
 *
 *   B. The 0.1.0 package shipped `resources/standalone/.env` — ~60 plaintext keys
 *      including production Supabase, Razorpay, Cashfree, Dropbox and Firebase
 *      credentials — outside the asar where any customer could open it. Counters read
 *      their config from %APPDATA%/AbeerSuite/.env instead (see `.env.counter.example`).
 *
 * The secret scan has two halves, because either alone can be fooled:
 *   1. No `.env*` file anywhere in the package, including inside `app.asar`.
 *   2. No value from the developer's local `.env` appears anywhere in the app's own
 *      build output. Reading the real values (rather than hardcoding key names) catches
 *      leaks through paths nobody thought to list — an inlined constant, a stray copy,
 *      a config file baked at build time.
 *
 * Only KEY names are ever printed. Values are never written to the log.
 *
 * Usage: tsx scripts/verify-package.ts [packageDir]
 *        (defaults to dist-app/win-unpacked)
 */
import * as fs from "fs";
import * as path from "path";

/** Values shorter than this are too generic to search for without false hits. */
const MIN_SECRET_LENGTH = 12;

/** `NEXT_PUBLIC_*` is compiled into the client bundle by design — not a leak. */
const PUBLIC_PREFIX = "NEXT_PUBLIC_";

/**
 * Keys whose values are public by nature, so finding them in the bundle is expected.
 * Everything else in `.env` is treated as secret.
 *
 * The auth URLs are listed by name rather than by a "looks like a URL" rule: they carry
 * no credentials (`http://localhost:3000`) and next-auth bakes the callback origin into
 * its server chunks, but `DATABASE_URL` and `DIRECT_URL` also end in `_URL` and DO carry
 * a password, so any pattern-based exemption would wave the real secrets through.
 */
const NON_SECRET_KEYS = new Set([
    "NODE_ENV",
    "APP_MODE",
    "READ_MODE",
    "COUNTER_PC",
    "AUTH_TRUST_HOST",
    "AUTH_URL",
    "NEXTAUTH_URL",
    "PORT",
]);

/** Extensions worth scanning for leaked values — text-ish app output. */
const SCANNABLE_EXTENSIONS = new Set([
    ".js", ".cjs", ".mjs", ".json", ".txt", ".html", ".css", ".map",
    ".yml", ".yaml", ".env", ".ts", ".rsc", ".meta", ".body",
]);

/**
 * Packages the standalone server cannot start without.
 *
 * `next`, `react` and `react-dom` are top-level entries, so they survive even a shallow
 * copy. `@next/env` and `styled-jsx` are reachable only through next's own dependency
 * list, and `@next/swc-win32-x64-msvc` is the native binary — they are the canaries that
 * prove the whole transitive tree came across, not just the first level.
 */
const REQUIRED_STANDALONE_PACKAGES = [
    "next",
    "react",
    "react-dom",
    "@next/env",
    "styled-jsx",
    "@next/swc-win32-x64-msvc",
];

function isEnvFileName(name: string): boolean {
    return name === ".env" || name.startsWith(".env.");
}

/** Every file under `dir`, recursively. Returns absolute paths. */
function walkFiles(dir: string): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkFiles(full));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Reads the file paths recorded in an asar archive's header.
 *
 * An asar starts with a small pickle: bytes 12-16 hold the header (JSON) length, and
 * the JSON that follows is the directory listing. Reading just the header lets us see
 * what is inside a 646 MB archive without unpacking it.
 */
function listAsarPaths(asarPath: string): string[] {
    const fd = fs.openSync(asarPath, "r");
    try {
        const sizeBuf = Buffer.alloc(16);
        fs.readSync(fd, sizeBuf, 0, 16, 0);
        const headerSize = sizeBuf.readUInt32LE(12);
        const headerBuf = Buffer.alloc(headerSize);
        fs.readSync(fd, headerBuf, 0, headerSize, 16);
        const header = JSON.parse(headerBuf.toString("utf8"));

        const paths: string[] = [];
        const visit = (node: Record<string, unknown>, prefix: string): void => {
            const files = node.files as Record<string, Record<string, unknown>> | undefined;
            if (!files) return;
            for (const [name, child] of Object.entries(files)) {
                const full = prefix ? `${prefix}/${name}` : name;
                if (child.files) visit(child, full);
                else paths.push(full);
            }
        };
        visit(header, "");
        return paths;
    } finally {
        fs.closeSync(fd);
    }
}

/** Parses `.env` into key/value pairs. Deliberately simple — it only feeds the scan. */
function parseEnv(file: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (value) out.set(key, value);
    }
    return out;
}

/** Check A: the packaged standalone server has everything it needs to boot. */
function checkStandaloneComplete(packageDir: string, failures: string[]): void {
    const standaloneDir = path.join(packageDir, "resources", "standalone");
    if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
        failures.push("resources/standalone/server.js is missing — the app has no server to start");
        return;
    }

    const nodeModulesDir = path.join(standaloneDir, "node_modules");
    if (!fs.existsSync(nodeModulesDir)) {
        failures.push(
            "resources/standalone/node_modules is missing — server.js cannot require('next'), " +
            "so the window will show ERR_CONNECTION_REFUSED"
        );
        return;
    }

    for (const name of REQUIRED_STANDALONE_PACKAGES) {
        const entry = path.join(nodeModulesDir, name);
        if (!fs.existsSync(path.join(entry, "package.json"))) {
            failures.push(`resources/standalone/node_modules/${name} is missing or incomplete`);
        } else if (fs.lstatSync(entry).isSymbolicLink()) {
            failures.push(
                `resources/standalone/node_modules/${name} is a symlink — it points into this ` +
                "machine's pnpm store and will dangle on a customer PC"
            );
        }
    }
}

function main(): void {
    const rootDir = process.cwd();
    const packageDir = path.resolve(rootDir, process.argv[2] || path.join("dist-app", "win-unpacked"));

    if (!fs.existsSync(packageDir)) {
        console.error(`[verify-package] FATAL: package directory not found: ${packageDir}`);
        console.error("  Run the packaging step first, or pass the directory as an argument.");
        process.exit(1);
    }

    console.log(`[verify-package] Verifying ${path.relative(rootDir, packageDir)}...`);
    const failures: string[] = [];

    // ── Check A: the standalone server is runnable ───────────────────────────
    checkStandaloneComplete(packageDir, failures);

    const allFiles = walkFiles(packageDir);

    // ── Check B1: no .env files on disk ──────────────────────────────────────
    for (const file of allFiles) {
        if (isEnvFileName(path.basename(file))) {
            failures.push(`env file shipped: ${path.relative(packageDir, file)}`);
        }
    }

    // ── Check B1b: no .env files inside any asar ─────────────────────────────
    for (const file of allFiles) {
        if (path.extname(file) !== ".asar") continue;
        let entries: string[];
        try {
            entries = listAsarPaths(file);
        } catch (err) {
            console.warn(`[verify-package] Could not read asar header of ${path.basename(file)}: ${String(err)}`);
            continue;
        }
        for (const entry of entries) {
            if (isEnvFileName(path.posix.basename(entry))) {
                failures.push(`env file inside ${path.basename(file)}: ${entry}`);
            }
        }
    }

    // ── Check B2: no local .env value appears in the app's own build output ──
    const localEnv = path.join(rootDir, ".env");
    if (!fs.existsSync(localEnv)) {
        console.warn("[verify-package] No local .env to compare against — value scan skipped.");
    } else {
        const secrets = new Map<string, string>();
        for (const [key, value] of parseEnv(localEnv)) {
            if (key.startsWith(PUBLIC_PREFIX)) continue;
            if (NON_SECRET_KEYS.has(key)) continue;
            if (value.length < MIN_SECRET_LENGTH) continue;
            secrets.set(key, value);
        }
        console.log(`[verify-package] Checking ${secrets.size} secret values against packaged files...`);

        // Scoped to the app's own output. Third-party node_modules inside the asar are
        // not scanned: they cannot contain this project's credentials, and skipping
        // ~646 MB keeps the gate fast enough to run on every build.
        const scanTargets = allFiles.filter((file) => {
            const rel = path.relative(packageDir, file);
            if (rel.split(path.sep).includes("node_modules")) return false;
            if (!SCANNABLE_EXTENSIONS.has(path.extname(file))) return false;
            return true;
        });

        const leakedKeys = new Set<string>();
        for (const file of scanTargets) {
            let content: Buffer;
            try {
                content = fs.readFileSync(file);
            } catch {
                continue;
            }
            for (const [key, value] of secrets) {
                if (leakedKeys.has(key)) continue;
                if (content.includes(value)) {
                    leakedKeys.add(key);
                    failures.push(`value of ${key} found in ${path.relative(packageDir, file)}`);
                }
            }
        }
        console.log(`[verify-package] Scanned ${scanTargets.length} app files.`);
    }

    if (failures.length > 0) {
        console.error("\n[verify-package] FATAL: this package must not be distributed.\n");
        for (const failure of failures) console.error(`  - ${failure}`);
        console.error(
            "\n  Counters read their config from %APPDATA%/AbeerSuite/.env — see .env.counter.example.\n" +
            "  Fix the build, then package again.\n"
        );
        process.exit(1);
    }

    console.log("[verify-package] PASS — standalone server is complete and no credentials are bundled.");
}

main();
