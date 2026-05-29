import { randomUUID } from "crypto";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/backup — Vercel functions can't run pg_dump, so this
// triggers a GitHub Actions run that dumps the DB and uploads it to Storage.
// Returns a jobId the client polls via /api/settings/backup/status.
export async function POST() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    const jobId = randomUUID();
    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", { job_id: jobId });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ jobId });
}
