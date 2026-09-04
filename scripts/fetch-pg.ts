#!/usr/bin/env node
/**
 * Downloads and trims the embedded PostgreSQL that ships inside the desktop installer.
 *
 * Run once per build machine (and again on a version bump):
 *
 *     pnpm pg:fetch
 *
 * ── Why the binaries are fetched rather than committed ───────────────────────
 * `resources/pgsql` is ~80 MB after trimming and ~350 MB before it. Git is the wrong
 * place for either. This script is the reproducible substitute: pinned version, pinned
 * checksum, deterministic trim — so every build machine ends up with byte-identical
 * binaries without the repo carrying them.
 *
 * ── Why bundle at all, rather than download on first run ─────────────────────
 * Measured 2026-08-26: the packaging gate reports `resources/` at 464 MB against its
 * 800 MB ceiling (`scripts/verify-package.ts`), leaving ~336 MB of headroom — enough
 * for the trimmed bundle several times over. Bundling means a counter's local database
 * works on first boot with no network, and removes an entire download/checksum/extract
 * path from the runtime. `electron/postgresManager.ts` already resolves
 * `resources/pgsql/bin`, and `package.json`'s `extraResources` already ships it.
 *
 * ── Why this major version ───────────────────────────────────────────────────
 * PostgreSQL 17, because Supabase reports `server_version = 17.6`. The local replica
 * must match on major version or the schema will not restore faithfully — enums,
 * generated columns and JSONB all changed representation across majors.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "resources", "pgsql");
const CACHE = path.join(ROOT, ".pg-download-cache");

/** Must match Supabase's major version. See the header note. */
const PG_VERSION = "17.6-1";

/**
 * EnterpriseDB's "binaries only" zip — the server without the installer, pgAdmin or
 * StackBuilder. This is the same artifact their one-click installer unpacks.
 */
const PG_URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-windows-x64-binaries.zip`;

/**
 * Pinned SHA-256 of that zip. Empty until someone runs this once and pastes in the
 * hash it prints — an unpinned download is a supply-chain hole, so the script says so
 * loudly rather than pretending the check happened.
 */
const PG_SHA256 = "d378882abd001a186735acd6f6ba716bca6ccd192e800412d4fd15ed25376b3e";

/**
 * Directories removed after extraction. Everything here is documentation, developer
 * headers, debug symbols, or translated server messages — none of it is read by
 * `initdb` or by a running server.
 *
 * Deliberately NOT trimmed: `lib/` and the rest of `share/`. `share/` holds
 * `postgres.bki`, the `*.sample` configs and the timezone database, without which
 * `initdb` fails outright; `lib/` holds `plpgsql.dll`, which every database installs by
 * default. Both are small enough that trimming them buys a few MB in exchange for a
 * failure mode that only shows up on a counter, at install time, in a shop.
 */
const TRIM_DIRS = [
    "doc",
    "include",
    "symbols",
    "pgAdmin 4",
    "StackBuilder",
    path.join("share", "locale"),
    path.join("share", "doc"),
    path.join("share", "man"),
];

/**
 * Proof the trim did not remove something the app needs.
 *
 * The first three start the local replica. `pg_dump`/`pg_restore` are the desktop app's
 * only copy of the client tools — `electron/backupManager.ts` runs them to back up and
 * restore Supabase — so a future addition to TRIM_DIRS has to fail here rather than on a
 * counter, on the day someone finally needs the backup.
 */
const REQUIRED_BINARIES = ["postgres.exe", "initdb.exe", "pg_ctl.exe", "pg_dump.exe", "pg_restore.exe"];

function log(msg: string): void {
    console.log(`[fetch-pg] ${msg}`);
}

function humanMb(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dirSize(dir: string): number {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += dirSize(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
    }
    return total;
}

/** Follows redirects manually — EnterpriseDB serves the zip from a CDN via 302. */
async function download(url: string, dest: string): Promise<void> {
    log(`Downloading ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
    }
    const expected = Number(res.headers.get("content-length") ?? 0);
    if (expected) log(`Size: ${humanMb(expected)}`);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

function sha256(file: string): string {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Windows-only, and that is fine: this fetches Windows binaries for a Windows
 * installer. Uses PowerShell's Expand-Archive rather than adding a zip dependency to
 * the repo for a script that runs once per build machine.
 */
function extract(zip: string, into: string): void {
    log("Extracting…");
    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command",
            `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`],
        { stdio: "inherit" },
    );
    if (result.status !== 0) {
        throw new Error(`Expand-Archive failed with code ${result.status}`);
    }
}

async function main(): Promise<void> {
    if (process.platform !== "win32") {
        throw new Error("This fetches Windows x64 binaries and must run on Windows.");
    }

    fs.mkdirSync(CACHE, { recursive: true });
    const zipPath = path.join(CACHE, `postgresql-${PG_VERSION}-windows-x64-binaries.zip`);

    if (fs.existsSync(zipPath)) {
        log(`Reusing cached download (${humanMb(fs.statSync(zipPath).size)}).`);
    } else {
        await download(PG_URL, zipPath);
    }

    const digest = sha256(zipPath);
    if (!PG_SHA256) {
        log("");
        log("WARNING: PG_SHA256 is not pinned, so this download was NOT verified.");
        log("Pin it by pasting the following into PG_SHA256 in this file:");
        log(`  ${digest}`);
        log("");
    } else if (digest !== PG_SHA256) {
        throw new Error(
            `Checksum mismatch — refusing to use this download.\n` +
            `  expected ${PG_SHA256}\n  actual   ${digest}\n` +
            "Delete .pg-download-cache and retry; if it repeats, do not proceed.",
        );
    } else {
        log("Checksum verified.");
    }

    // Extract to a staging dir first: a half-extracted resources/pgsql would look
    // complete enough for postgresManager.ts to try to start it.
    const staging = path.join(CACHE, "staging");
    fs.rmSync(staging, { recursive: true, force: true });
    extract(zipPath, staging);

    // The zip contains a single top-level `pgsql/` directory.
    const extracted = path.join(staging, "pgsql");
    if (!fs.existsSync(extracted)) {
        throw new Error(`Expected a pgsql/ directory inside the archive, found: ${fs.readdirSync(staging).join(", ")}`);
    }

    const before = dirSize(extracted);
    for (const rel of TRIM_DIRS) {
        const target = path.join(extracted, rel);
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
            log(`trimmed ${rel}`);
        }
    }
    const after = dirSize(extracted);
    log(`Trimmed ${humanMb(before)} → ${humanMb(after)}`);

    for (const exe of REQUIRED_BINARIES) {
        if (!fs.existsSync(path.join(extracted, "bin", exe))) {
            throw new Error(`Trim removed something essential: bin/${exe} is missing.`);
        }
    }

    fs.rmSync(DEST, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(DEST), { recursive: true });
    fs.renameSync(extracted, DEST);
    fs.rmSync(staging, { recursive: true, force: true });

    log(`Done — ${humanMb(dirSize(DEST))} in resources/pgsql.`);
    log("The next `pnpm electron:build` will bundle it into the installer.");
}

main().catch((err) => {
    console.error("[fetch-pg] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
});
