/**
 * Backup and restore, run on this PC, against Supabase.
 *
 * ── Why this exists next to the Dropbox path ─────────────────────────────────
 * The web app cannot make a dump: Vercel functions have no `pg_dump`, so
 * `/api/settings/backup` only dispatches a GitHub Actions run that dumps to Dropbox.
 * Since the counter builds stopped shipping the `DROPBOX_*`/`GITHUB_*` keys, that
 * whole path reports "not available here" on a shop PC — which left a desktop shop
 * with no way to take a backup at all.
 *
 * The desktop app already carries the tools. `resources/pgsql/bin` ships PostgreSQL
 * 17.6 for the local replica, and that is the same 17.6 Supabase reports as its
 * `server_version` — so `pg_dump` here produces exactly what the GitHub runner's
 * `postgresql-client-17` produces. The flags below are copied from
 * `.github/workflows/backup.yml` and `restore.yml` deliberately: a dump taken on a
 * counter and a dump taken by the runner must stay interchangeable.
 *
 * ── Source and target ────────────────────────────────────────────────────────
 * Supabase, both ways. Never the local replica: a replica dump would look like a
 * real backup and restore a partial database. The URL is resolved here, in main,
 * from the same env the app already loads — it is never sent to the renderer.
 */
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getEmbeddedBinPath } from "./postgresManager";

/** How many stderr lines to keep for the failure message. Enough to see the real cause. */
const ERROR_TAIL = 12;

export interface BackupAvailability {
    /** Both directions need the same two things, so this is one answer, not two. */
    available: boolean;
    /** Supabase project ref of the database that will be dumped / replaced, "" if unknown. */
    projectRef: string;
    /** Plain-English reason when `available` is false. Never a key name or a libpq string. */
    reason: string;
}

export interface RunResult {
    ok: boolean;
    /** Absolute path written (backup) or read (restore). */
    filePath?: string;
    /** Size of the dump on disk. */
    bytes?: number;
    /** Set when `ok` is false. Already staff-readable. */
    error?: string;
}

/**
 * The database to dump from / restore into.
 *
 * `DIRECT_URL` first, and it is not a preference: `DATABASE_URL` is the pgBouncer pool
 * (`:6543/?pgbouncer=true`). "pgbouncer" is a Prisma-only query parameter — libpq rejects
 * any URI parameter it does not know, so `pg_dump` exits immediately with "invalid URI
 * query parameter" and leaves a 0-byte file behind. `/api/settings/backup` prefers
 * `DIRECT_URL` for the same reason.
 *
 * The `DATABASE_URL` fallback strips the Prisma-only parameters so it at least connects.
 * It still points at the transaction pooler, where a long `pg_dump` may be cut off, so it
 * is a last resort for a machine whose env predates `DIRECT_URL`, not the normal path.
 */
export function resolveSupabaseUrl(): string | null {
    const direct = process.env.DIRECT_URL?.trim();
    if (isPostgresUrl(direct)) return direct!;

    const pooled = process.env.DATABASE_URL?.trim();
    if (isPostgresUrl(pooled)) return stripPrismaParams(pooled!);

    return null;
}

function isPostgresUrl(url: string | undefined): boolean {
    return Boolean(url && (url.startsWith("postgres://") || url.startsWith("postgresql://")));
}

/** Parameters libpq understands. Everything else in the URL is Prisma's and is dropped. */
const LIBPQ_PARAMS = new Set([
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "connect_timeout",
    "application_name",
    "target_session_attrs",
    "options",
]);

function stripPrismaParams(url: string): string {
    const q = url.indexOf("?");
    if (q === -1) return url;

    const kept = url
        .slice(q + 1)
        .split("&")
        .filter((pair) => pair && LIBPQ_PARAMS.has(pair.split("=")[0].toLowerCase()));

    return kept.length > 0 ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}

/**
 * Splits a Postgres URL into the `PG*` variables libpq reads from the environment.
 *
 * Why not pass the URL on the command line, as the workflows do: on a shared shop PC the
 * full argv of every process is readable, and a spawn error would carry the password into
 * `main.log`. Environment variables are visible to this process's children only.
 *
 * Parsed by hand, not with `new URL()` — Supabase passwords routinely contain characters
 * the URL parser mangles or rejects, which `src/shared/lib/backup/dbUrl.ts` documents and
 * works around the same way. `(.*)@` is greedy on purpose: it splits at the LAST "@", so a
 * password containing "@" still leaves the host intact.
 *
 * Returns null when the shape is not recognised; the caller then falls back to `--dbname`.
 */
export function pgEnvFromUrl(url: string): Record<string, string> | null {
    const match = /^postgres(?:ql)?:\/\/(.*)@([^@]+)$/i.exec(url.trim());
    if (!match) return null;

    const [, userInfo, rest] = match;
    const colon = userInfo.indexOf(":");
    const user = decode(colon === -1 ? userInfo : userInfo.slice(0, colon));
    const password = colon === -1 ? "" : decode(userInfo.slice(colon + 1));
    if (!user) return null;

    const hostMatch = /^([^/:?]+)(?::(\d+))?(?:\/([^?]*))?(?:\?(.*))?$/.exec(rest);
    if (!hostMatch) return null;
    const [, host, port, database, query] = hostMatch;
    if (!host) return null;

    // sslmode from the URL when it says one, "require" otherwise: Supabase refuses
    // plaintext, and libpq's own default ("prefer") would silently try it first.
    const sslmode = new URLSearchParams(query ?? "").get("sslmode") ?? "require";

    const env: Record<string, string> = {
        PGHOST: host,
        PGPORT: port || "5432",
        PGUSER: user,
        PGDATABASE: decode(database || "postgres"),
        PGSSLMODE: sslmode,
    };
    if (password) env.PGPASSWORD = password;
    return env;
}

function decode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * "postgresql://postgres.gphtzbejvpijcfmvqpqo:…@…" → "gphtzbejvpijcfmvqpqo".
 *
 * A copy of `projectRefFromDbUrl` from `src/shared/lib/backup/dbUrl.ts`, not an import:
 * `electron/tsconfig.json` is rooted at `electron/`, and an import reaching outside that
 * root would change the emitted output path — the same constraint `postgresManager.ts`
 * documents for `appModeCore.ts`. Six lines, kept identical on purpose.
 */
export function projectRefFromUrl(url: string | null): string {
    const match = /^[a-z][a-z0-9+.-]*:\/\/(.*)@/i.exec(url?.trim() ?? "");
    if (!match) return "";
    const user = match[1].split(":")[0];
    const dot = user.indexOf(".");
    return dot === -1 ? "" : user.slice(dot + 1);
}

function toolPath(tool: "pg_dump" | "pg_restore"): string {
    return path.join(getEmbeddedBinPath(), process.platform === "win32" ? `${tool}.exe` : tool);
}

/**
 * Can this machine back up at all?
 *
 * Two ways it cannot, and a shop can hit either: an installer built without
 * `resources/pgsql` (see the warning in `scripts/electron-build.ts`) has no client tools,
 * and a machine whose `.env` carries neither URL has nothing to dump. Both answer here,
 * before any dialog opens, so the card can say so instead of the operator picking a file
 * and then meeting a libpq error.
 */
export function backupAvailability(): BackupAvailability {
    const url = resolveSupabaseUrl();
    const projectRef = projectRefFromUrl(url);

    if (!fs.existsSync(toolPath("pg_dump")) || !fs.existsSync(toolPath("pg_restore"))) {
        return {
            available: false,
            projectRef,
            reason: "This installation does not include the PostgreSQL tools, so it cannot make or apply a backup. Reinstall the app to get them.",
        };
    }
    if (!url) {
        return {
            available: false,
            projectRef: "",
            reason: "No database connection is configured on this machine, so there is nothing to back up.",
        };
    }
    return { available: true, projectRef, reason: "" };
}

/**
 * Runs one of the two client tools against Supabase, streaming its progress out.
 *
 * Both tools report progress on stderr (that is what `--verbose` writes to), so stderr is
 * not an error channel here — the exit code is. The tail is kept only to explain a failure.
 */
function runPgTool(
    tool: "pg_dump" | "pg_restore",
    args: string[],
    url: string,
    onProgress: (line: string) => void,
): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
        const pgEnv = pgEnvFromUrl(url);
        // Fall back to the command line only when the URL could not be split. Losing the
        // backup entirely would be the worse trade; the password is then visible in argv
        // for the length of the run, as it is on the GitHub runner.
        const finalArgs = pgEnv ? args : [...args, "--dbname", url];

        const child = spawn(toolPath(tool), finalArgs, {
            env: { ...process.env, ...(pgEnv ?? {}) },
            windowsHide: true,
        });

        const tail: string[] = [];
        let buffer = "";

        child.stderr.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const text = line.trim();
                if (!text) continue;
                onProgress(text);
                tail.push(text);
                if (tail.length > ERROR_TAIL) tail.shift();
            }
        });

        child.on("error", (err) => {
            console.error(`[BackupManager] ${tool} could not start:`, err);
            resolve({ ok: false, error: `Could not start ${tool}: ${err.message}` });
        });

        child.on("close", (code) => {
            if (code === 0) {
                resolve({ ok: true });
                return;
            }
            console.error(`[BackupManager] ${tool} exited ${code}`);
            resolve({
                ok: false,
                error: tail.length > 0 ? tail.join("\n") : `${tool} failed (exit code ${code}).`,
            });
        });
    });
}

/**
 * Dumps Supabase to `destPath`.
 *
 * Flags copied from `.github/workflows/backup.yml`. `--schema=public` is the important
 * one: Supabase's own schemas (auth, storage, extensions, graphql, …) are owned by a
 * superuser and cannot be restored as the "postgres" role, so including them produces
 * hundreds of harmless-but-fatal errors on restore.
 */
export async function runBackup(destPath: string, onProgress: (line: string) => void): Promise<RunResult> {
    const availability = backupAvailability();
    if (!availability.available) return { ok: false, error: availability.reason };

    const url = resolveSupabaseUrl()!;
    onProgress("Connecting to the database…");

    const result = await runPgTool(
        "pg_dump",
        ["--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--verbose", "--file", destPath],
        url,
        onProgress,
    );

    if (!result.ok) {
        // A failed run still creates the file, and a 0-byte dump left on the Desktop is
        // exactly the thing someone restores from six months later.
        fs.rmSync(destPath, { force: true });
        return { ok: false, error: result.error };
    }

    const bytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    if (bytes === 0) {
        fs.rmSync(destPath, { force: true });
        return { ok: false, error: "The backup came out empty, so it was not kept. Nothing was changed in the database." };
    }

    console.log(`[BackupManager] Backup written: ${destPath} (${bytes} bytes)`);
    return { ok: true, filePath: destPath, bytes };
}

/**
 * Replaces Supabase's `public` schema with the contents of `srcPath`.
 *
 * Flags copied from `.github/workflows/restore.yml`. `--jobs=4` matters for the same
 * reason it does there — the round trip to the database dominates, not the CPU.
 *
 * One thing the workflow does that this cannot: it follows the restore with `prisma db
 * push`, re-applying any schema change that shipped after the dump was taken. There is no
 * Prisma CLI in the packaged app, so restoring a dump older than the running app version
 * can leave the app reading for a column the dump does not have. The card says so.
 */
export async function runRestore(srcPath: string, onProgress: (line: string) => void): Promise<RunResult> {
    const availability = backupAvailability();
    if (!availability.available) return { ok: false, error: availability.reason };

    if (!fs.existsSync(srcPath)) return { ok: false, error: "That backup file no longer exists." };
    if (fs.statSync(srcPath).size === 0) return { ok: false, error: "That backup file is empty — nothing was restored." };

    const url = resolveSupabaseUrl()!;
    console.log(`[BackupManager] Restore starting from ${srcPath}`);
    onProgress("Connecting to the database…");

    const result = await runPgTool(
        "pg_restore",
        [
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
            "--jobs=4",
            "--verbose",
            srcPath,
        ],
        url,
        onProgress,
    );

    if (!result.ok) return { ok: false, error: result.error };

    console.log("[BackupManager] Restore finished.");
    return { ok: true, filePath: srcPath };
}

/**
 * `smx-backup-<ref>-local-2026-09-02-000045-IST.dump`.
 *
 * Deliberately the same shape as `makeBackupFileName` in `src/shared/lib/backup/dropbox.ts`
 * — the two kinds of dump end up in one folder often enough that they must sort and read
 * alike. "local" takes the place of its manual/cron/git source marker, so the name still
 * says where the dump came from. IST for the reason that file documents: a backup taken at
 * midnight IST is named 18:30 the previous day in UTC — correct, and reliably misread.
 */
export function makeLocalBackupFileName(projectRef: string): string {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp =
        `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}` +
        `-${p(ist.getUTCHours())}${p(ist.getUTCMinutes())}${p(ist.getUTCSeconds())}-IST`;
    return `${["smx-backup", projectRef, "local", stamp].filter(Boolean).join("-")}.dump`;
}
