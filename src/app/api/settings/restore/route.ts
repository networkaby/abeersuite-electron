import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getDirectDatabaseUrl } from "@/shared/lib/backup/directDatabaseUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/restore — multipart upload of a pg_dump custom-format
// file. Runs `pg_restore --clean --if-exists` against the direct DB URL,
// replacing all data. Requires confirm === "RESTORE".
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    let directUrl: string;
    try {
        directUrl = getDirectDatabaseUrl();
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    const form = await req.formData();
    const confirm = form.get("confirm");
    const dump = form.get("dump");

    if (confirm !== "RESTORE") {
        return Response.json({ error: "Type RESTORE to confirm." }, { status: 400 });
    }
    if (!(dump instanceof File) || dump.size === 0) {
        return Response.json({ error: "Backup file is required." }, { status: 400 });
    }

    const tmpPath = join(tmpdir(), `smx-restore-${randomUUID()}.dump`);
    const buf = Buffer.from(await dump.arrayBuffer());
    await writeFile(tmpPath, buf);

    try {
        const { code, stderr } = await runPgRestore(directUrl, tmpPath);
        if (code !== 0) {
            return Response.json(
                { error: `pg_restore exited with code ${code}`, stderr: stderr.slice(-4000) },
                { status: 500 },
            );
        }
        return Response.json({ ok: true, log: stderr.slice(-4000) });
    } finally {
        await unlink(tmpPath).catch(() => {});
    }
}

function runPgRestore(directUrl: string, file: string): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "pg_restore",
            ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", directUrl, file],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        const chunks: Buffer[] = [];
        child.stderr.on("data", (c: Buffer) => chunks.push(c));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stderr: Buffer.concat(chunks).toString("utf8") }));
    });
}
