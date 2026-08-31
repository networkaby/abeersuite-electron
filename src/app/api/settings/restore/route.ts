import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { isUnderBackupFolder } from "@/shared/lib/backup/dropbox";
import { backupAvailability, COUNTER_ONLY_MESSAGE } from "@/shared/lib/backup/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/restore — triggers the GitHub Actions run that downloads
// the chosen dump from Dropbox and runs pg_restore. Fire-and-forget: the user
// picks a file already in Dropbox (see /api/settings/restore/list), so nothing
// is uploaded through the browser and the page can be closed after triggering.
// Requires confirm === "RESTORE".
//
// This is the most destructive call in the app — it rolls the shared production database
// back to an older dump for every branch at once. `confirm: "RESTORE"` guards a misclick,
// not a caller, so the permission is what actually limits who can do it. Counter builds
// ship a working GitHub token, so any till could otherwise trigger it straight from
// devtools without the settings panel ever opening.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    // Checked before the confirm text: on a machine that cannot restore at all, asking the
    // operator to type RESTORE is noise, and the failure would otherwise arrive as
    // "DROPBOX_APP_KEY is not set." after they had already typed it.
    const { canRestore, missing } = backupAvailability();
    if (!canRestore) {
        return Response.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    const body = (await req.json().catch(() => null)) as {
        path?: string;
        confirm?: string;
        targetDbUrl?: string;
    } | null;
    if (!body || body.confirm !== "RESTORE") {
        return Response.json({ error: "Type RESTORE to confirm." }, { status: 400 });
    }
    const targetDbUrl = body.targetDbUrl?.trim();
    if (!targetDbUrl || (!targetDbUrl.startsWith("postgres://") && !targetDbUrl.startsWith("postgresql://"))) {
        return Response.json(
            { error: "Target Database URL is required and must start with postgresql:// or postgres://" },
            { status: 400 },
        );
    }
    if (!isUnderBackupFolder(body.path)) {
        return Response.json({ error: "Invalid or unsupported backup path." }, { status: 400 });
    }

    try {
        await triggerWorkflow(process.env.GITHUB_RESTORE_WORKFLOW?.trim() || "restore.yml", {
            file_path: body.path,
            target_db_url: targetDbUrl,
        });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true });
}
