import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { requireScheduledPage } from "@/modules/campaigns/lib/campaignAccess";
import { previewDueReminders, remindersSentToday } from "@/shared/lib/whatsapp/dueReminders";

/**
 * GET /api/campaigns/scheduled — Campaigns → Scheduled: everything that goes out
 * on its own, and what already went today.
 *
 *   reminders   today's automatic due-reminder run: when, and who it would reach
 *   remindersSent  every reminder logged today (manual, Send to all, the job)
 *   posts       posts with a time and a channel still to share, soonest first
 *   shares      posts shared today, per channel
 *
 * The party dues behind the preview come from loadPartyDues' one-minute cache.
 */
export async function GET() {
    const { response } = await requireScheduledPage();
    if (response) return response;

    try {
        const todayStart = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00+05:30`);
        const [reminders, remindersSent, posts, shares] = await Promise.all([
            previewDueReminders(),
            remindersSentToday(),
            prisma.post.findMany({
                where: { status: "SCHEDULED", scheduledAt: { not: null } },
                select: { id: true, caption: true, channels: true, scheduledAt: true, shares: { select: { channel: true } } },
                orderBy: { scheduledAt: "asc" },
                take: 100,
            }),
            prisma.postShare.findMany({
                where: { sharedAt: { gte: todayStart } },
                select: { id: true, channel: true, sharedAt: true, sharedByName: true, post: { select: { id: true, caption: true } } },
                orderBy: { sharedAt: "desc" },
            }),
        ]);
        return NextResponse.json({
            reminders,
            remindersSent,
            posts: posts
                .map((p) => ({ id: p.id, caption: p.caption, scheduledAt: p.scheduledAt, channels: p.channels.filter((c) => !p.shares.some((s) => s.channel === c)) }))
                .filter((p) => p.channels.length),
            shares: shares.map((s) => ({ id: s.id, channel: s.channel, sharedAt: s.sharedAt, by: s.sharedByName, postId: s.post.id, caption: s.post.caption })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load the scheduled list");
    }
}
