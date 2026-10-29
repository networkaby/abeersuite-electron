import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { requireScheduledPage } from "@/modules/campaigns/lib/campaignAccess";
import { channelTime } from "@/modules/campaigns/lib/post";
import { previewDueReminders, remindersSentToday } from "@/shared/lib/whatsapp/dueReminders";
import { previewEmailReminders } from "@/shared/lib/email/emailReminders";
import { EMAIL_TEMPLATE_LABEL, isEmailKind } from "@/shared/lib/email/emailTemplates";

/**
 * GET /api/campaigns/scheduled — Campaigns → Scheduled: everything that goes out
 * on its own, and what already went today.
 *
 *   reminders   today's automatic due-reminder run: when, and who it would reach (WhatsApp)
 *   remindersSent  every reminder logged today (manual, Send to all, the job)
 *   emails      cart / payment-pending emails the next run would send
 *   emailsSent  every email logged today, any kind (EmailNotification)
 *   campaigns   scheduled campaigns, soonest first, and those sent today (Notification)
 *   posts       posts with a time and a channel still to share, soonest first (Social)
 *   shares      posts shared today, per channel
 *
 * The party dues behind the preview come from loadPartyDues' one-minute cache.
 */
export async function GET() {
    const { response } = await requireScheduledPage();
    if (response) return response;

    try {
        const todayStart = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00+05:30`);
        const [reminders, remindersSent, emails, emailsSent, campaigns, posts, shares] = await Promise.all([
            previewDueReminders(),
            remindersSentToday(),
            previewEmailReminders(),
            prisma.emailNotification.findMany({
                where: { createdAt: { gte: todayStart } },
                select: { id: true, kind: true, email: true, status: true, createdAt: true },
                orderBy: { createdAt: "desc" },
                take: 200,
            }),
            prisma.campaign.findMany({
                where: { OR: [{ status: "SCHEDULED" }, { status: "SENT", sentAt: { gte: todayStart } }] },
                select: { id: true, name: true, title: true, channel: true, status: true, scheduledAt: true, sentAt: true },
                orderBy: [{ scheduledAt: "asc" }, { sentAt: "desc" }],
                take: 100,
            }),
            prisma.post.findMany({
                where: { status: "SCHEDULED", scheduledAt: { not: null } },
                select: { id: true, caption: true, channels: true, scheduledAt: true, variants: true, shares: { select: { channel: true } } },
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
            emails: emails.map((e) => ({ ...e, label: EMAIL_TEMPLATE_LABEL[e.kind] })),
            emailsSent: emailsSent.map((e) => ({ ...e, label: isEmailKind(e.kind) ? EMAIL_TEMPLATE_LABEL[e.kind] : e.kind })),
            campaigns,
            // One line per time: a channel copy with its own time gets its own line.
            posts: posts
                .flatMap((p) => {
                    const byTime = new Map<number, string[]>();
                    for (const c of p.channels.filter((c) => !p.shares.some((s) => s.channel === c))) {
                        const at = channelTime(p, c)!.getTime();
                        byTime.set(at, [...(byTime.get(at) ?? []), c]);
                    }
                    return [...byTime].map(([at, channels]) => ({ id: p.id, caption: p.caption, scheduledAt: new Date(at), channels }));
                })
                .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()),
            shares: shares.map((s) => ({ id: s.id, channel: s.channel, sharedAt: s.sharedAt, by: s.sharedByName, postId: s.post.id, caption: s.post.caption })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load the scheduled list");
    }
}
