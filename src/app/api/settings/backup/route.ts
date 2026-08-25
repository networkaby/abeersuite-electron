import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { backupAvailability, COUNTER_ONLY_MESSAGE } from "@/shared/lib/backup/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/backup — Vercel functions can't run pg_dump, so this
// triggers a GitHub Actions run that dumps the DB and uploads it to Dropbox.
// Fire-and-forget: returns immediately with the file name the dump will get.
// The user can close the page; the file shows up in Dropbox a few minutes later.
//
// settings:manage, not just a signed-in staff member: counter builds ship a working
// GitHub token, so this is reachable from any till without the settings UI ever opening.
export async function POST() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    // A build without the GitHub keys has no way to make a dump at all. Refuse here, in
    // words a staff member can act on, rather than letting triggerWorkflow throw
    // "GITHUB_DISPATCH_TOKEN is not set." into a toast on the shop floor.
    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return Response.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    const fileName = makeBackupFileName();
    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", { file_name: fileName });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ fileName });
}
