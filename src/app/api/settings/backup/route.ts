import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { backupAvailability, COUNTER_ONLY_MESSAGE } from "@/shared/lib/backup/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/backup — Vercel functions can't run pg_dump, so this
// triggers a GitHub Actions run that dumps the DB and uploads it to Dropbox.
// Fire-and-forget: returns immediately; the workflow names the dump itself.
// The user can close the page; the file shows up in Dropbox a few minutes later.
//
// settings:manage, not just a signed-in staff member: counter builds ship a working
// GitHub token, so this is reachable from any till without the settings UI ever opening.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    // A build without the GitHub keys has no way to make a dump at all. Refuse here, in
    // words a staff member can act on, rather than letting triggerWorkflow throw
    // "GITHUB_DISPATCH_TOKEN is not set." into a toast on the shop floor.
    const { canBackup, missing } = backupAvailability();
    if (!canBackup) {
        return Response.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    // "x-forwarded-host" first: behind Vercel's proxy the plain Host header is the
    // internal hostname, not the site the user is actually on. Client-controlled, so
    // it is a label only — it is sanitised into a file-name segment, never trusted.
    const domain = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];

    // The workflow dumps whatever its DIRECT_DATABASE_URL repo secret points at and
    // names the file itself — only the side holding the URL can read its project ref.
    // The app never sends the URL: a workflow INPUT is echoed in full in the run log
    // (secrets are masked, inputs are not), so sending it printed the password on
    // every run. A password rotation therefore also updates that repo secret.
    const inputs: Record<string, string> = { source: "manual", domain };

    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", inputs);
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    // The workflow names the file, so this side cannot know it (the panel says so).
    return Response.json({ fileName: null });
}
