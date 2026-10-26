import { NextResponse } from "next/server";
import { runEmailReminders } from "@/shared/lib/email/emailReminders";

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
    const secret = process.env.CRON_SECRET?.trim();
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runEmailReminders());
}
