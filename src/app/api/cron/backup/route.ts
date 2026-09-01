import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { backupAvailability } from "@/shared/lib/backup/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/backup — Invoked by Vercel Cron on a daily schedule.
 *
 * Secured by Vercel's automatic Authorization header (Bearer <CRON_SECRET>).
 * Reads the active deployment's database URL and triggers the GitHub Actions
 * backup runner, which dumps the database and uploads it to Dropbox.
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // Verify caller is Vercel Cron (if CRON_SECRET is set in deployment env)
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return Response.json(
            { error: "Backup cannot run: required GitHub/Dropbox keys missing.", missing },
            { status: 503 },
        );
    }

    // DIRECT_URL first, and it matters: DATABASE_URL is the pgBouncer pool
    // (:6543/?pgbouncer=true). "pgbouncer" is a Prisma-only query param — libpq
    // rejects any URI param it does not know, so pg_dump exits immediately with
    // "invalid URI query parameter" and the run uploads a 0-byte dump.
    const dbUrl = (process.env.DIRECT_URL ?? process.env.DATABASE_URL)?.trim();
    if (!dbUrl || (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://"))) {
        return Response.json(
            { error: "Active database URL is missing or invalid in server environment." },
            { status: 500 },
        );
    }

    const fileName = makeBackupFileName();
    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", {
            file_name: fileName,
            source_db_url: dbUrl,
        });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true, fileName, triggeredAt: new Date().toISOString() });
}
