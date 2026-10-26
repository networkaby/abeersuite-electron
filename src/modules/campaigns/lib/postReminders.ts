import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { pushNoticesToStaff } from "@/shared/lib/push/staffPush";
import { POST_REMINDER_EVERY_MIN } from "@/shared/lib/constants/campaigns";
import { channelOf } from "@/modules/campaigns/lib/post";

export type PostReminderResult = { due: number; devices: number };

/**
 * Posts whose time has come and that still have a channel to share — staff are
 * pushed one notice per post, then again every POST_REMINDER_EVERY_MIN until it
 * is shared on all its channels (or unscheduled). The gap is the app's, not the
 * ring's: each post is claimed by moving `lastRemindedAt` in a guarded update
 * before the push, so a faster ring, a Test run or two rings at once push it
 * once per gap. Phase 2 shares through the networks' APIs from here instead.
 */
export async function runPostReminders(now = new Date()): Promise<PostReminderResult> {
    const gapStart = new Date(now.getTime() - POST_REMINDER_EVERY_MIN * 60_000);
    const remindable = { OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: gapStart } }] };
    const posts = await prisma.post.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now }, ...remindable },
        select: { id: true, caption: true, channels: true, shares: { select: { channel: true } } },
        orderBy: { scheduledAt: "asc" },
        take: 50,
    });

    const due: { id: number; caption: string; pending: string[] }[] = [];
    for (const p of posts) {
        const pending = p.channels.filter((c) => !p.shares.some((s) => s.channel === c));
        if (!pending.length) continue;
        const { count } = await prisma.post.updateMany({ where: { id: p.id, ...remindable }, data: { lastRemindedAt: now } });
        if (count) due.push({ id: p.id, caption: p.caption, pending });
    }

    const devices = await pushNoticesToStaff(
        due.map((p) => ({
            title: "Post due — share now",
            body: `${p.pending.map((c) => channelOf(c)?.label ?? c).join(", ")}: ${p.caption}`,
            url: `/office/campaigns/posts/${p.id}`,
            tag: `post-${p.id}`,
        })),
    );
    return { due: due.length, devices };
}
