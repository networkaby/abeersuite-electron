import { NextResponse } from "next/server";
import { runEmailReminders } from "@/shared/lib/email/emailReminders";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/email-reminders — abandoned-cart and payment-pending emails.
 *
 * Not scheduled on its own any more: /api/cron/communications runs it every 30
 * minutes (cron-job.org). Kept for a manual run. Each run is safe to repeat: every email is claimed
 * once per cart / order (EmailNotification).
 *
 * CRON_SECRET is optional, as for /api/cron/due-reminders — blank counts as absent.
 */
export async function GET(req: Request) {
    // CRON_SECRET or the cron-job.org key on Settings → Incoming API (incomingApi.ts).
    if (!(await requireIncomingKey(req, "CRON"))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runEmailReminders());
}
