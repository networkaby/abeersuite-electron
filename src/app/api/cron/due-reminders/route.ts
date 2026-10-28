import { NextResponse } from "next/server";
import { runDueReminders } from "@/shared/lib/whatsapp/dueReminders";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/due-reminders — the daily due-reminder job.
 *
 * Not scheduled on its own any more: /api/cron/communications runs it every 30
 * minutes (08:00–20:00 IST, cron-job.org). Kept for a manual run. The job decides: it sends on the
 * first call at or after Campaigns → Due Reminders' send time, once per India
 * day, and only while automatic reminders are switched on.
 *
 * CRON_SECRET is optional, as for /api/cron/backup-due — blank counts as absent.
 */
export async function GET(req: Request) {
    // CRON_SECRET or the cron-job.org key on Settings → Incoming API (incomingApi.ts).
    if (!(await requireIncomingKey(req, "CRON"))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runDueReminders());
}
