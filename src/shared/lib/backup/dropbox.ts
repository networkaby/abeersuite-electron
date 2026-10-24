/**
 * Server-side Dropbox helper for the backup/restore feature. The dump itself is
 * produced/consumed by `pg_dump`/`pg_restore` running in a GitHub Actions runner
 * (Vercel functions can't run those binaries); Dropbox is the durable file store
 * the runner writes to / reads from, so the job is fire-and-forget — the browser
 * never has to stay open to download or upload the file.
 *
 * The app only needs Dropbox here to LIST the available backups (for the restore
 * picker). The actual upload/download happens in the workflows. Uses the Dropbox
 * HTTP API via fetch — no SDK, mirroring githubDispatch.ts.
 *
 * Never import this from a client component — it reads the app secret.
 *
 * Requires env: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, and
 * optional DROPBOX_FOLDER (default "" = the app-folder root for an App-folder app).
 */

export interface DropboxBackup {
    name: string;
    /** Full Dropbox path, e.g. "/smx-backup-2026-05-29-0641.dump". */
    path: string;
    size: number;
    /** ISO timestamp of when Dropbox last saw the file change. */
    modified: string;
}

/** Normalised backup folder: "" (app-folder root) or "/sub/folder" (no trailing slash). */
export function backupFolder(): string {
    const raw = process.env.DROPBOX_FOLDER?.trim() ?? "";
    if (!raw || raw === "/") return "";
    const noTrailing = raw.replace(/\/+$/, "");
    return noTrailing.startsWith("/") ? noTrailing : `/${noTrailing}`;
}

/**
 * Structural guard so a restore can only target a real `.dump` inside the backup
 * folder — blocks path traversal / arbitrary Dropbox reads.
 */
export function isUnderBackupFolder(path: string | null | undefined): path is string {
    if (typeof path !== "string") return false;
    if (path.includes("..") || path.includes("\0")) return false;
    if (!path.toLowerCase().endsWith(".dump")) return false;
    const folder = backupFolder();
    const prefix = folder === "" ? "/" : `${folder}/`;
    if (!path.startsWith(prefix)) return false;
    // Disallow nested sub-paths beyond the backup folder (no extra "/").
    return path.slice(prefix.length).indexOf("/") === -1;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Mints a short-lived access token from the long-lived refresh token (cached). */
export async function getDropboxAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

    const key = process.env.DROPBOX_APP_KEY?.trim();
    const secret = process.env.DROPBOX_APP_SECRET?.trim();
    const refresh = process.env.DROPBOX_REFRESH_TOKEN?.trim();
    if (!key) throw new Error("DROPBOX_APP_KEY is not set.");
    if (!secret) throw new Error("DROPBOX_APP_SECRET is not set.");
    if (!refresh) throw new Error("DROPBOX_REFRESH_TOKEN is not set.");

    const res = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refresh,
            client_id: key,
            client_secret: secret,
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Dropbox token refresh failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    cachedToken = {
        token: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 14_400) * 1000,
    };
    return cachedToken.token;
}

interface DropboxEntry {
    [".tag"]: string;
    name: string;
    path_display?: string;
    path_lower?: string;
    size?: number;
    server_modified?: string;
}

/** Lists `*.dump` backups in the backup folder, newest first. Empty if none yet. */
export async function listBackups(): Promise<DropboxBackup[]> {
    const token = await getDropboxAccessToken();
    const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: backupFolder(), recursive: false }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Folder not created yet → no backups, not an error.
        if (res.status === 409 && text.includes("not_found")) return [];
        throw new Error(`Dropbox list_folder failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { entries: DropboxEntry[] };
    return json.entries
        .filter((e) => e[".tag"] === "file" && e.name.toLowerCase().endsWith(".dump"))
        .map((e) => ({
            name: e.name,
            path: e.path_display ?? e.path_lower ?? `${backupFolder()}/${e.name}`,
            size: e.size ?? 0,
            modified: e.server_modified ?? "",
        }))
        .sort((a, b) => b.modified.localeCompare(a.modified));
}
