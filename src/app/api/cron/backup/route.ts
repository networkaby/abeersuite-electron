import { backupAvailability } from "@/shared/lib/backup/availability";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { dispatchBackupWithCopy } from "@/shared/lib/backup/standbyCopy.server";

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
    // The run dumps the primary (a LABEL, never an address: backup.yml picks the
    // DIRECT_DATABASE_URL_1 / _2 secret) and copies it into the standby; a finished copy
    // is what "Lock for switch" needs. Shared with the "Copy into standby now" button.
    const domain = process.env.VERCEL_URL?.trim() ?? "";
    let result: Awaited<ReturnType<typeof dispatchBackupWithCopy>>;
    try {
        result = await dispatchBackupWithCopy({ source: "cron", domain });
    } catch (err) {
        console.error("[cron/backup] 500: workflow dispatch failed:", (err as Error).message);
        return Response.json({ error: (err as Error).message }, { status: 500 });
    }

    return Response.json({ ok: true, fileName: result.fileName, triggeredAt: new Date().toISOString() });
}
