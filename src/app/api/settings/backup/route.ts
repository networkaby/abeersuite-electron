import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { libpqUrl, projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
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

    // "x-forwarded-host" first: behind Vercel's proxy the plain Host header is the
    // internal hostname, not the site the user is actually on. Client-controlled, so
    // it is a label only — it is sanitised into a file-name segment, never trusted.
    const domain = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];

    // What the workflow always gets. Without a file_name it builds one itself, using
    // the project ref of whatever database it ends up dumping.
    const inputs: Record<string, string> = { source: "manual", domain };

    // ── The app supplies the database URL ───────────────────────────────────────
    // IN PRODUCTION, COMMENT OUT THIS BLOCK. The runner then dumps whatever the
    // DIRECT_DATABASE_URL repo secret points at and names the file there — which it
    // must, because that database may not be the one this app uses and only the side
    // holding the URL can read its project ref.
    //
    // Sending it is right while credentials rotate: the app always holds the current
    // one, so a rotation needs no repo change. It costs one thing — source_db_url is
    // a workflow INPUT, and GitHub echoes inputs in full in the job's env group.
    // Secrets are masked; inputs are not. So every run below prints the password.
    //
    // DIRECT_URL first. The desktop app has none (counterEnv.ts withholds it), so it
    // sends the live DATABASE_URL — the pgBouncer pool, cleaned of Prisma's
    // `pgbouncer=true` by libpqUrl, exactly as "Back up to this PC" does.
    const dbUrl = libpqUrl(process.env.DIRECT_URL) ?? libpqUrl(process.env.DATABASE_URL);
    if (!dbUrl) {
        return Response.json(
            { error: "Active database URL is missing or invalid in server environment." },
            { status: 500 },
        );
    }
    inputs.source_db_url = dbUrl;
    inputs.file_name = makeBackupFileName({ domain, projectRef: projectRefFromDbUrl(dbUrl), source: "manual" });
    // ── end of block to comment out ─────────────────────────────────────────────

    try {
        await triggerWorkflow(process.env.GITHUB_BACKUP_WORKFLOW?.trim() || "backup.yml", inputs);
    } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    // null once the block above is commented out — this side cannot know the name then.
    return Response.json({ fileName: inputs.file_name ?? null });
}
