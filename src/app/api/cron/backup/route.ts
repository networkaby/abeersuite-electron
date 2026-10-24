import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { backupAvailability } from "@/shared/lib/backup/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/backup — Invoked by Vercel Cron on a daily schedule.
 *
 * Secured by Vercel's automatic Authorization header (Bearer <CRON_SECRET>).
 * Triggers the GitHub Actions backup runner, which dumps the database and uploads it to Dropbox.
 */
export async function GET(req: Request) {
    // CRON_SECRET is OPTIONAL. Unset, empty, or whitespace means the check is
    // skipped and the endpoint is open to anyone who knows the URL — deliberate, so
    // that a deployment missing the variable still backs up rather than silently
    // failing every night. Set it when the endpoint should be locked down; a blank
    // value is treated as absent so a half-filled env var cannot lock the scheduler
    // out by accident.
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return Response.json(
            { error: "Backup cannot run: required GitHub/Dropbox keys missing.", missing },
            { status: 503 },
        );
    }

    // Vercel Cron calls this directly, so there is no browser Host header to read.
    const domain = process.env.VERCEL_URL?.trim() ?? "";
    const inputs: Record<string, string> = { source: "cron", domain };

    // No database URL is sent: the workflow dumps whatever its DIRECT_DATABASE_URL
    // repo secret points at and names the file there — same as the settings route,
    // and for the same reason (a workflow input is printed in full in the run log).

    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", inputs);
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    // The workflow names the file, so this side cannot know it.
    return Response.json({ ok: true, fileName: null, triggeredAt: new Date().toISOString() });
}
