import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { pushNoticesToStaff } from "@/shared/lib/push/staffPush";
import { channelOf } from "@/modules/campaigns/lib/post";

export type PostReminderResult = { due: number; devices: number };

/**
 * Posts whose time has come and that still have a channel to share — staff are
 * pushed one notice per post. No "already reminded" mark: every run repeats the
 * notice for everything still pending, so a post nags each half hour until it is
 * shared on all its channels (or unscheduled). Phase 2 shares through the
 * networks' APIs from here instead.
 */
export async function runPostReminders(now = new Date()): Promise<PostReminderResult> {
    const posts = await prisma.post.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now } },
        select: { id: true, caption: true, channels: true, shares: { select: { channel: true } } },
        orderBy: { scheduledAt: "asc" },
        take: 50,
    });
    const due = posts
        .map((p) => ({ ...p, pending: p.channels.filter((c) => !p.shares.some((s) => s.channel === c)) }))
        .filter((p) => p.pending.length);

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
