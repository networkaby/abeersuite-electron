import { NextResponse } from "next/server";
import { runEmailReminders } from "@/shared/lib/email/emailReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/email-reminders — abandoned-cart and payment-pending emails.
 *
 * Woken by the hourly backup-scheduled.yml tick and, as a floor, by the daily
 * Vercel cron (vercel.json). Each run is safe to repeat: every email is claimed
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
