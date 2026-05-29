import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase Storage admin client (service-role key) used by the
 * backup/restore API routes. Backups can't run `pg_dump` inside a Vercel
 * function, so the dump/restore happens in a GitHub Actions runner and the
 * file is exchanged through a private Storage bucket. These helpers create the
 * signed URLs and read status files the routes need.
 *
 * Never import this from a client component — it reads the service-role key.
 */

export const BACKUP_BUCKET = process.env.BACKUP_BUCKET?.trim() || "backups";

/** Job ids are server-generated UUIDs; reject anything else to stop path traversal. */
export function isValidJobId(jobId: string | null | undefined): jobId is string {
    return typeof jobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(jobId);
}

export const dumpPath = (jobId: string) => `dumps/${jobId}.dump`;
export const restorePath = (jobId: string) => `restores/${jobId}.dump`;
export const restoreStatusPath = (jobId: string) => `restores/${jobId}.status.json`;

let cached: SupabaseClient | null = null;

function supabaseUrl(): string {
    const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!url) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.");
    return url.replace(/\/$/, "");
}

function admin(): SupabaseClient {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
    if (!cached) cached = createClient(supabaseUrl(), key, { auth: { persistSession: false } });
    return cached;
}

/** Signed URL to download an existing object, or null if it doesn't exist yet. */
export async function getSignedDownloadUrl(path: string, expiresIn = 300): Promise<string | null> {
    const { data, error } = await admin().storage.from(BACKUP_BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data) return null;
    return data.signedUrl;
}

/** Absolute signed URL the browser can PUT a file to (token embedded in URL). */
export async function createSignedUpload(path: string): Promise<string> {
    const { data, error } = await admin().storage.from(BACKUP_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message ?? "unknown error"}`);
    // Newer storage-js returns an absolute signedUrl; older returns a relative path.
    return data.signedUrl.startsWith("http") ? data.signedUrl : `${supabaseUrl()}/storage/v1${data.signedUrl}`;
}

/** Reads and parses a small JSON object from storage, or null if absent. */
export async function readJson<T>(path: string): Promise<T | null> {
    const { data, error } = await admin().storage.from(BACKUP_BUCKET).download(path);
    if (error || !data) return null;
    try {
        return JSON.parse(await data.text()) as T;
    } catch {
        return null;
    }
}
