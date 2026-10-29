import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { FacebookError, facebookReady, postReelToFacebook, postStoryToFacebook, postToFacebook } from "@/modules/campaigns/lib/facebookPage";
import { channelOf, facebookAutoBlock, facebookReelBlock, facebookStoryBlock } from "@/modules/campaigns/lib/post";
import { COPY_SELECT, asChannelCopy, channelDue, claimPostFor, recordShare } from "@/modules/campaigns/lib/postServer";

const FACEBOOK = "FACEBOOK";
const AUTO_NAME = "Auto (Facebook)";

/**
 * The three things the Facebook connection posts to: the Page feed, its story
 * and its reels. Each is its own channel on a post, with its own copy, time and
 * share line; this says how each goes up and what stops it going by itself.
 */
type Copy = ReturnType<typeof asChannelCopy<Parameters<typeof asChannelCopy>[0]>>;
const FACEBOOK_CHANNELS: Record<string, { send: (p: Copy) => Promise<string | null>; block: (p: Copy) => string | null }> = {
    FACEBOOK: { send: (p) => postToFacebook(p as never), block: (p) => facebookAutoBlock(p) },
    FACEBOOK_STORY: { send: (p) => postStoryToFacebook(p), block: (p) => facebookStoryBlock(p) },
    FACEBOOK_REEL: { send: (p) => postReelToFacebook(p as never), block: (p) => facebookReelBlock(p) },
};
export const isFacebookChannel = (c: string) => c in FACEBOOK_CHANNELS;

const POST_FOR_FACEBOOK = {
    id: true,
    ...COPY_SELECT,
    link: true,
    channels: true,
    updatedAt: true,
} as const;

/**
 * Put one post up on the Facebook Page and log the share. `again` lets staff
 * post one already shared there once more. Claimed first (claimPostFor), so
 * the button racing the communications job sends it once. Throws
 * FacebookError with a readable reason.
 */
export async function sendPostToFacebook(postId: number, by: { userId: number | null; name?: string }, again = false, channel = FACEBOOK) {
    const how = FACEBOOK_CHANNELS[channel];
    if (!how) throw new FacebookError("Not a Facebook channel.");
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { ...POST_FOR_FACEBOOK, shares: { where: { channel }, select: { id: true }, take: 1 } },
    });
    if (!post) return null;
    await claimPostFor(post, channel, channelOf(channel)?.label ?? "Facebook", again, (m) => new FacebookError(m));
    const url = await how.send(asChannelCopy(post, channel));
    return { post: await recordShare(postId, channel, by.userId, by.name), url };
}

export type FacebookPostsResult = { sent: number; failed: { id: number; error: string }[]; skipped?: string };

/**
 * Scheduled posts whose time has come and that still wait for Facebook — sent
 * by the communications job. One Facebook cannot take by itself (a WebP) is
 * left for the "Post due" reminder and a hand share.
 */
export async function runFacebookPosts(now = new Date()): Promise<FacebookPostsResult> {
    if (!(await facebookReady())) return { sent: 0, failed: [], skipped: "Facebook Page not connected" };
    const out: FacebookPostsResult = { sent: 0, failed: [] };
    for (const [channel, how] of Object.entries(FACEBOOK_CHANNELS)) {
        const due = await prisma.post.findMany({
            where: { status: "SCHEDULED", scheduledAt: { lte: now }, channels: { has: channel }, shares: { none: { channel } } },
            select: { id: true, ...COPY_SELECT, createdById: true },
            orderBy: { scheduledAt: "asc" },
            take: 50,
        });
        for (const p of due) {
            if (!channelDue(p, channel, now) || how.block(asChannelCopy(p, channel))) continue;
            try {
                await sendPostToFacebook(p.id, { userId: p.createdById, name: AUTO_NAME }, false, channel);
                out.sent++;
            } catch (e) {
                out.failed.push({ id: p.id, error: (e as Error).message });
                // Lost access fails every post the same way — stop instead of hammering Facebook.
                if (e instanceof FacebookError && /connect again|not connected/.test(e.message)) return out;
            }
        }
    }
    return out;
}
