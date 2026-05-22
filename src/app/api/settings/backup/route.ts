import { spawn } from "child_process";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDirectDatabaseUrl } from "@/shared/lib/backup/directDatabaseUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/settings/backup — runs pg_dump and returns the resulting custom-
// format dump as a download. Buffers the full output so we can return a
// readable JSON error if pg_dump fails (streaming would leave the browser
// with an opaque "Failed to fetch").
export async function POST() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    let directUrl: string;
    try {
        directUrl = getDirectDatabaseUrl();
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    const result = await runPgDump(directUrl);
    if (result.code !== 0) {
        return Response.json(
            { error: `pg_dump exited with code ${result.code}`, stderr: result.stderr.slice(-4000) },
            { status: 500 },
        );
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `smx-backup-${stamp}.dump`;

    return new Response(new Uint8Array(result.stdout), {
        status: 200,
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
            "Content-Length": String(result.stdout.length),
        },
    });
}

function runPgDump(directUrl: string): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "pg_dump",
            ["--format=custom", "--no-owner", "--no-privileges", "--dbname", directUrl],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on("data", (c: Buffer) => out.push(c));
        child.stderr.on("data", (c: Buffer) => err.push(c));
        child.on("error", reject);
        child.on("close", (code) =>
            resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }),
        );
    });
}

function pad(n: number) {
    return String(n).padStart(2, "0");
}
