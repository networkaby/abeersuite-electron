import { NextResponse } from "next/server";
import { runDueReminders } from "@/shared/lib/whatsapp/dueReminders";
import { runEmailReminders } from "@/shared/lib/email/emailReminders";
import { runFacebookPosts } from "@/modules/campaigns/lib/facebookPosts";
import { runInstagramPosts } from "@/modules/campaigns/lib/instagram";
import { runPostReminders } from "@/modules/campaigns/lib/postReminders";
import { runScheduledCampaigns } from "@/modules/campaigns/lib/sendCampaign";
import { runGooglePosts } from "@/modules/campaigns/lib/googlePosts";
import { syncGoogleReviews } from "@/modules/reviews/lib/googleReviews";
import { runStatusAutoMoves } from "@/modules/repairing/lib/autoMoveTickets";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { runCounterQueue } from "@/shared/lib/counter/counterQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/communications — every pending customer message and social post, in one call.
 *
 * Woken every 30 minutes from 08:00 to 20:00 IST by cron-job.org. Runs the due
 * reminders, the email reminders, the post reminders and any
 * scheduled campaign whose time has come, side by side; each is
 * safe to repeat and decides for itself whether anything is due. One failing
 * does not stop the others — its error is logged and returned under its name.
 * Due posts go to Google Business Profile, the Facebook Page and Instagram first, on their
 * own, so the post reminders that follow no longer count them as waiting for a
 * hand share.
 * New and changed Google reviews are copied in for CRM → Reviews alongside.
 * Tickets left long enough in a status with an auto-move rule move on (autoMoveTickets.ts).
 * App notifications and emails a counter queued after its own WhatsApp go out (counterQueue.ts).
 * Backup is not part of this: Vercel's nightly cron owns it.
 *
 * CRON_SECRET is optional, as for /api/cron/due-reminders — blank counts as absent.
 */
export async function GET(req: Request) {
    // CRON_SECRET or the cron-job.org key on Settings → Incoming API (incomingApi.ts).
    if (!(await requireIncomingKey(req, "CRON"))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const out: Record<string, unknown> = {};
    try {
        out.googlePosts = await runGooglePosts();
    } catch (e) {
        console.error("[cron/communications] googlePosts failed:", e);
        out.googlePosts = { error: (e as Error)?.message ?? String(e) };
    }
    try {
        out.facebookPosts = await runFacebookPosts();
    } catch (e) {
        console.error("[cron/communications] facebookPosts failed:", e);
        out.facebookPosts = { error: (e as Error)?.message ?? String(e) };
    }
    try {
        out.instagramPosts = await runInstagramPosts();
    } catch (e) {
        console.error("[cron/communications] instagramPosts failed:", e);
        out.instagramPosts = { error: (e as Error)?.message ?? String(e) };
    }

    const jobs = { googleReviews: syncGoogleReviews, dueReminders: runDueReminders, emailReminders: runEmailReminders, postReminders: runPostReminders, campaigns: runScheduledCampaigns, statusAutoMoves: () => runStatusAutoMoves(), counterQueue: runCounterQueue };
    const settled = await Promise.allSettled(Object.values(jobs).map((run) => run()));
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
