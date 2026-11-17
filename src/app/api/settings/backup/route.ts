import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { backupWorkflowFile, triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
import { backupAvailability, COUNTER_ONLY_MESSAGE } from "@/shared/lib/backup/availability";
import { primaryAndStaging, realtimePrimary } from "@/shared/lib/db/dbPrimary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/settings/backup — Vercel functions can't run pg_dump, so this
// triggers a GitHub Actions run that dumps the DB and uploads it to Dropbox.
// Fire-and-forget: returns immediately with the file name the dump will get.
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
    const { canBackup, missing } = await backupAvailability();
    if (!canBackup) {
        return Response.json({ error: COUNTER_ONLY_MESSAGE, counterOnly: true, missing }, { status: 503 });
    }

    // "x-forwarded-host" first: behind Vercel's proxy the plain Host header is the
    // internal hostname, not the site the user is actually on. Client-controlled, so
    // it is a label only — it is sanitised into a file-name segment, never trusted.
    const domain = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];

    // What the workflow always gets. Without a file_name it builds one itself, using
    // the project ref of whatever database it ends up dumping.
    const inputs: Record<string, string> = { source: "manual", domain };

    // ── Which database: a LABEL, never an address ───────────────────────────────
    // Addresses live only in the GitHub secrets DIRECT_DATABASE_URL_1 / _2 (owner,
    // 2026-11-17); backup.yml picks the secret for the label and refuses to copy into
    // a writable database. On a counter the office's DB_PRIMARY_ID says which
    // one its DATABASE_URL is (realtimePrimary), since a counter holds only that one URL.
    const { primary } = await primaryAndStaging();
    inputs.source_db = realtimePrimary();
    inputs.file_name = makeBackupFileName({ domain, projectRef: projectRefFromDbUrl(primary.direct), source: "manual" });


    try {
        await triggerWorkflow(await backupWorkflowFile(), inputs);
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ fileName: inputs.file_name ?? null });
}
