import { backupWorkflowFile, triggerWorkflow } from "@/shared/lib/backup/githubDispatch";
import { makeBackupFileName } from "@/shared/lib/backup/dropbox";
import { projectRefFromDbUrl } from "@/shared/lib/backup/dbUrl";
import { backupAvailability } from "@/shared/lib/backup/availability";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { primaryAndStaging } from "@/shared/lib/db/dbPrimary";
import { markCopyFinished, markCopyStarted } from "@/shared/lib/db/dbSwitch.server";

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
    // CRON_SECRET is OPTIONAL. Unset, empty, or whitespace means the check is
    // skipped and the endpoint is open to anyone who knows the URL — deliberate, so
    // that a deployment missing the variable still backs up rather than silently
    // failing every night. Set it when the endpoint should be locked down; a blank
    // value is treated as absent so a half-filled env var cannot lock the scheduler
    // out by accident.
    // Settings → Incoming API's cron-job.org key is accepted too (incomingApi.ts).
    if (!(await requireIncomingKey(req, "CRON"))) {
        console.error("[cron/backup] 401: Authorization header matches neither CRON_SECRET nor the Incoming API cron key.");
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only the deployment holding the office domain takes the nightly dump. Two Vercel
    // projects run this code, and whichever holds office.networkservice.in is the real
    // production — the other may point at the same database (a duplicate dump) or at
    // one nobody uses. Vercel sets VERCEL_PROJECT_PRODUCTION_URL per deployment, so
    // after moving the domain, redeploy both. Unknown (unset) still backs up: a
    // duplicate is cheaper than a missed night.
    const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
    const officeHost = new URL(COMPANY_DETAILS.sites.office).host;
    if (productionHost && productionHost !== officeHost) {
        return Response.json({ skipped: true, reason: `Not the office site (${productionHost}); ${officeHost} takes the nightly backup.` });
    }

    const { canBackup, missing } = await backupAvailability();
    if (!canBackup) {
        console.error("[cron/backup] 503: backup keys missing:", missing);
        return Response.json(
            { error: "Backup cannot run: required GitHub/Dropbox keys missing.", missing },
            { status: 503 },
        );
    }

    // Vercel Cron calls this directly, so there is no browser Host header to read.
    const domain = process.env.VERCEL_URL?.trim() ?? "";
    const inputs: Record<string, string> = { source: "cron", domain };

    // ── Which database: a LABEL, never an address ───────────────────────────────
    // Addresses live only in the GitHub secrets DIRECT_DATABASE_URL_1 / _2 (owner,
    // 2026-11-17). backup.yml picks the secret for this label (NEXT_PUBLIC_DB_PRIMARY)
    // and refuses to copy into a database that is not read-only, so a wrong label can
    // never overwrite the live one.
    const { primary, staging } = await primaryAndStaging();
    inputs.source_db = primary.id;
    inputs.file_name = makeBackupFileName({ domain, projectRef: projectRefFromDbUrl(primary.direct), source: "cron" });

    // ── Nightly copy into the standby (DB1 / DB2 only) ──────────────────────────
    // The same run restores this dump into the standby and reports to
    // /api/cron/db-copied. A finished copy is what "Lock for switch" needs.
    if (staging) {
        inputs.standby_db = staging.id;
        await markCopyStarted(staging.id, inputs.file_name);
    }

    try {
        await triggerWorkflow(await backupWorkflowFile(), inputs);
    } catch (err) {
        if (staging) await markCopyFinished(staging.id, false).catch(() => {});
        console.error("[cron/backup] 500: workflow dispatch failed:", (err as Error).message);
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true, fileName: inputs.file_name ?? null, triggeredAt: new Date().toISOString() });
}
