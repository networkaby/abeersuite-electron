import { NextResponse } from "next/server";
import { runDueReminders } from "@/shared/lib/whatsapp/dueReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/due-reminders — the daily due-reminder job.
 *
 * Woken by the hourly backup-scheduled.yml tick and, as a floor, by the daily
 * Vercel cron (vercel.json, 12:00 IST). The job itself decides: it sends on the
 * first call at or after Settings → Due Reminders' send time, once per India
 * day, and only while automatic reminders are switched on.
 *
 * CRON_SECRET is optional, as for /api/cron/backup-due — blank counts as absent.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET?.trim();
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await runDueReminders());
}
