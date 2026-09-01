import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
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

    // "x-forwarded-host" first: behind Vercel's proxy the plain Host header is the
    // internal hostname, not the site the user is actually on. Client-controlled, so
    // it is a label only — it is sanitised into a file-name segment, never trusted.
    const domain = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
    const fileName = makeBackupFileName({
        domain,
        projectRef: projectRefFromDbUrl(dbUrl),
        source: "manual",
    });
    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", {
            file_name: fileName,
            source_db_url: dbUrl,
        });
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ fileName });
}
