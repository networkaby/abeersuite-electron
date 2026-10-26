import { NextResponse } from "next/server";
import { runDueReminders } from "@/shared/lib/whatsapp/dueReminders";
import { runEmailReminders } from "@/shared/lib/email/emailReminders";
import { runPostReminders } from "@/modules/campaigns/lib/postReminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/communications — every pending customer message and social post, in one call.
 *
 * Woken every 30 minutes from 08:00 to 20:00 IST by cron-job.org. Runs the due
 * reminders, the email reminders and the post reminders side by side; each is
 * safe to repeat and decides for itself whether anything is due. One failing
 * does not stop the others — its error is logged and returned under its name.
 * Backup is not part of this: Vercel's nightly cron owns it.
 *
 * CRON_SECRET is optional, as for /api/cron/due-reminders — blank counts as absent.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET?.trim();
    if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jobs = { dueReminders: runDueReminders, emailReminders: runEmailReminders, postReminders: runPostReminders };
    const settled = await Promise.allSettled(Object.values(jobs).map((run) => run()));
    const out: Record<string, unknown> = {};
    Object.keys(jobs).forEach((name, i) => {
        const r = settled[i];
        if (r.status === "fulfilled") out[name] = r.value;
        else {
            console.error(`[cron/communications] ${name} failed:`, r.reason);
            out[name] = { error: (r.reason as Error)?.message ?? String(r.reason) };
        }
    });
    return NextResponse.json(out);
}
