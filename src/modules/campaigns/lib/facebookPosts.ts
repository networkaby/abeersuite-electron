import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { FacebookError, facebookReady, postToFacebook } from "@/modules/campaigns/lib/facebookPage";
import { facebookAutoBlock } from "@/modules/campaigns/lib/post";
import { COPY_SELECT, asChannelCopy, channelDue, claimPostFor, recordShare } from "@/modules/campaigns/lib/postServer";

const FACEBOOK = "FACEBOOK";
const AUTO_NAME = "Auto (Facebook)";

const POST_FOR_FACEBOOK = {
    id: true,
    ...COPY_SELECT,
    link: true,
    channels: true,
    updatedAt: true,
    shares: { where: { channel: FACEBOOK }, select: { id: true }, take: 1 },
} as const;

/**
 * Put one post up on the Facebook Page and log the share. `again` lets staff
 * post one already shared there once more. Claimed first (claimPostFor), so
 * the button racing the communications job sends it once. Throws
 * FacebookError with a readable reason.
 */
export async function sendPostToFacebook(postId: number, by: { userId: number | null; name?: string }, again = false) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: POST_FOR_FACEBOOK });
    if (!post) return null;
    await claimPostFor(post, FACEBOOK, "Facebook", again, (m) => new FacebookError(m));
    const url = await postToFacebook(asChannelCopy(post, FACEBOOK));
    return { post: await recordShare(postId, FACEBOOK, by.userId, by.name), url };
}

export type FacebookPostsResult = { sent: number; failed: { id: number; error: string }[]; skipped?: string };

/**
 * Scheduled posts whose time has come and that still wait for Facebook — sent
 * by the communications job. One Facebook cannot take by itself (a WebP) is
 * left for the "Post due" reminder and a hand share.
 */
export async function runFacebookPosts(now = new Date()): Promise<FacebookPostsResult> {
    if (!(await facebookReady())) return { sent: 0, failed: [], skipped: "Facebook Page not connected" };
    const due = await prisma.post.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now }, channels: { has: FACEBOOK }, shares: { none: { channel: FACEBOOK } } },
        select: { id: true, ...COPY_SELECT, createdById: true },
        orderBy: { scheduledAt: "asc" },
        take: 50,
    });
    const out: FacebookPostsResult = { sent: 0, failed: [] };
    for (const p of due) {
        if (!channelDue(p, FACEBOOK, now) || facebookAutoBlock(asChannelCopy(p, FACEBOOK))) continue;
        try {
            await sendPostToFacebook(p.id, { userId: p.createdById, name: AUTO_NAME });
            out.sent++;
        } catch (e) {
            out.failed.push({ id: p.id, error: (e as Error).message });
            // Lost access fails every post the same way — stop instead of hammering Facebook.
            if (e instanceof FacebookError && /connect again|not connected/.test(e.message)) break;
        }
    }
    return out;
}
