import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { PHOTO_CLEANUP_MIN_AGE_DAYS } from "@/shared/lib/constants/inventory";

/**
 * Photo cleanup — find shop photos in Cloudinary that nothing uses any more, and
 * delete them to free space.
 *
 * Removing a photo in the app only takes its link off the product; the file stays
 * in Cloudinary. So do failed uploads, test shots and abandoned drafts. This finds
 * them by comparing two lists:
 *
 *   1. every file under `shop/` in Cloudinary (products, masters, home, ads), and
 *   2. every bit of text in the database that mentions `shop/`.
 *
 * A file whose name (public_id) appears nowhere in (2) and that is older than
 * PHOTO_CLEANUP_MIN_AGE_DAYS is garbage. (2) is the WHOLE database — every text
 * and JSON column of every table — not a list of known photo fields, so a place
 * that holds a link and was never listed here can still not lose its photo. Only
 * AuditLog is left out: it keeps old copies of every edited product, so counting
 * it would keep every removed photo for ever. A recycle-bin restore can therefore
 * bring back a product whose old photo is gone.
 *
 * Matching is a plain "does the text contain the name" — an Adjust or Skip-for-AI
 * link still holds the file's name, and a name that is the start of another only
 * errs towards keeping.
 */

const PREFIX = "shop/";
const SKIP_TABLES = new Set(["AuditLog"]);

export type CloudFile = { publicId: string; bytes: number; createdAt: string; url: string };
export type CleanupPlan = {
    /** Files under shop/ in Cloudinary. */
    total: number;
    totalBytes: number;
    /** Unused and old enough — what Clean deletes. */
    garbage: CloudFile[];
    garbageBytes: number;
    /** Unused but newer than the age limit — kept for now. */
    youngUnused: number;
};

function cloud() {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const key = process.env.CLOUDINARY_API_KEY;
    const secret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !key || !secret) return null;
    return {
        base: `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`,
        auth: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    };
}

export function cleanupConfigured(): boolean {
    return cloud() !== null;
}

async function listCloudFiles(): Promise<CloudFile[]> {
    const c = cloud();
    if (!c) throw new Error("Cloudinary is not set up on this server.");
    const files: CloudFile[] = [];
    let cursor: string | undefined;
    do {
        const q = new URLSearchParams({ prefix: PREFIX, max_results: "500" });
        if (cursor) q.set("next_cursor", cursor);
        const res = await fetch(`${c.base}?${q}`, { headers: { Authorization: c.auth }, cache: "no-store" });
        if (!res.ok) throw new Error(`Cloudinary list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as {
            resources: { public_id: string; bytes: number; created_at: string; secure_url: string }[];
            next_cursor?: string;
        };
        for (const r of body.resources) files.push({ publicId: r.public_id, bytes: r.bytes, createdAt: r.created_at, url: r.secure_url });
        cursor = body.next_cursor;
    } while (cursor);
    return files;
}

/**
 * How much text after each "shop/" the database sends back. A public id longer than
 * this cannot be matched in full, so `isUsed` counts it as used.
 */
const SNIPPET_CHARS = 300;

/**
 * Every "shop/" in the database with the text that follows it, joined — ONE query.
 *
 * Only those snippets travel, not the rows: a product that mentions a photo used to
 * come back whole (description, specs, every JSON column), on every scan. Splitting
 * the row text at each "shop/" keeps every occurrence, so `includes(publicId)` on the
 * snippets answers exactly as it did on the whole text — for any id `isUsed` lets
 * through.
 */
async function databaseText(): Promise<string> {
    const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
          AND table_name NOT LIKE '\\_%'`;
    const byTable = new Map<string, string[]>();
    for (const c of cols) {
        if (SKIP_TABLES.has(c.table_name)) continue;
        byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    }
    const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
    const selects = [...byTable].map(([table, columns]) => {
        const text = `concat_ws(' ', ${columns.map((c) => `${q(c)}::text`).join(", ")})`;
        return `SELECT part FROM ${q(table)}, unnest((string_to_array(${text}, '${PREFIX}'))[2:]) AS part`
            + ` WHERE ${text} LIKE '%${PREFIX}%'`;
    });
    if (selects.length === 0) return "";
    const rows = await prisma.$queryRawUnsafe<{ t: string }[]>(
        `SELECT DISTINCT '${PREFIX}' || left(part, ${SNIPPET_CHARS}) AS t FROM (${selects.join(" UNION ALL ")}) s`,
    );
    return rows.map((r) => r.t).join("\n");
}

/**
 * Does the database text mention this file? An id the snippets cannot hold in full —
 * longer than a snippet, or with a second "shop/" inside it, where the split cuts —
 * counts as used, so the cleanup can only ever keep it.
 */
function isUsed(text: string, publicId: string): boolean {
    if (publicId.length > PREFIX.length + SNIPPET_CHARS || publicId.indexOf(PREFIX, 1) !== -1) return true;
    return text.includes(publicId);
}

/** Cloudinary's files and the database text, read together. */
async function scan(): Promise<{ files: CloudFile[]; text: string }> {
    const [files, text] = await Promise.all([listCloudFiles(), databaseText()]);
    return { files, text };
}

export type LibraryPhoto = { url: string; publicId: string; createdAt: string; used: boolean };

// The photo library is read on every picker open, and each read scans the whole
// database and pages through Cloudinary's Admin API (~500 calls an hour on the free
// plan) — so one scan serves everyone for a while. A stale "used" mark only sorts a
// photo onto the wrong tab of the picker; the cleanup never reads this cache.
const LIBRARY_TTL_MS = 15 * 60_000;
let libraryCache: { at: number; photos: LibraryPhoto[] } | null = null;

/**
 * Every shop photo in Cloudinary, newest first, marked used / unused — for the
 * product page's "From library" picker, so a removed or never-saved photo can be
 * put on a product again without uploading it twice. Cached briefly; the
 * cleanup never reads this cache.
 */
export async function photoLibrary(): Promise<LibraryPhoto[]> {
    if (libraryCache && Date.now() - libraryCache.at < LIBRARY_TTL_MS) return libraryCache.photos;
    const { files, text } = await scan();
    const photos = files
        .map((f) => ({ url: f.url, publicId: f.publicId, createdAt: f.createdAt, used: isUsed(text, f.publicId) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    libraryCache = { at: Date.now(), photos };
    return photos;
}

export async function planCleanup(): Promise<CleanupPlan> {
    const { files, text } = await scan();
    const cutoff = Date.now() - PHOTO_CLEANUP_MIN_AGE_DAYS * 86_400_000;
    const unused = files.filter((f) => !isUsed(text, f.publicId));
    const garbage = unused.filter((f) => Date.parse(f.createdAt) < cutoff);
    return {
        total: files.length,
        totalBytes: files.reduce((s, f) => s + f.bytes, 0),
        garbage,
        garbageBytes: garbage.reduce((s, f) => s + f.bytes, 0),
        youngUnused: unused.length - garbage.length,
    };
}

/** Delete `publicIds` from Cloudinary, 100 per request. Returns how many went. */
export async function deleteCloudFiles(publicIds: string[]): Promise<number> {
    const c = cloud();
    if (!c) throw new Error("Cloudinary is not set up on this server.");
    let deleted = 0;
    for (let i = 0; i < publicIds.length; i += 100) {
        const q = new URLSearchParams();
        for (const id of publicIds.slice(i, i + 100)) q.append("public_ids[]", id);
        const res = await fetch(`${c.base}?${q}`, { method: "DELETE", headers: { Authorization: c.auth } });
        if (!res.ok) throw new Error(`Cloudinary delete failed after ${deleted} (${res.status}): ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { deleted: Record<string, string> };
        deleted += Object.values(body.deleted).filter((v) => v === "deleted").length;
    }
    libraryCache = null;
    return deleted;
}
