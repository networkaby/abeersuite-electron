import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { GoogleError, googleReady, postToGoogle } from "@/modules/campaigns/lib/googleBusiness";
import { googleAutoBlock } from "@/modules/campaigns/lib/post";
import { recordShare } from "@/modules/campaigns/lib/postServer";

const GOOGLE = "GOOGLE_BUSINESS";
const AUTO_NAME = "Auto (Google)";

const POST_FOR_GOOGLE = {
    id: true,
    caption: true,
    link: true,
    channels: true,
    googleType: true,
    googleButton: true,
    mediaKey: true,
    mediaType: true,
    updatedAt: true,
    shares: { where: { channel: GOOGLE }, select: { id: true }, take: 1 },
} as const;

/**
 * Put one post up on Google and log the share. `again` lets staff post a post
 * already shared there once more. The post is claimed first by moving its
 * updatedAt in a guarded update, so Post to Google racing the communications
 * job (or a double click) sends it once. Throws GoogleError with a readable reason.
 */
export async function sendPostToGoogle(postId: number, by: { userId: number | null; name?: string }, again = false) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: POST_FOR_GOOGLE });
    if (!post) return null;
    if (!post.channels.includes(GOOGLE)) throw new GoogleError("This post is not meant for Google — tick it under channels first.");
    if (post.shares.length && !again) throw new GoogleError("Already posted on Google.");
    const { count } = await prisma.post.updateMany({ where: { id: postId, updatedAt: post.updatedAt }, data: { updatedAt: new Date() } });
    if (!count) throw new GoogleError("This post is being sent or was just changed — refresh and try again.");
    const url = await postToGoogle(post);
    return { post: await recordShare(postId, GOOGLE, by.userId, by.name), url };
}

export type GooglePostsResult = { sent: number; failed: { id: number; error: string }[]; skipped?: string };

/**
 * Scheduled posts whose time has come and that still wait for Google — sent by
 * the communications job. A post Google cannot take by itself (Offer, Event,
 * video) is left for the "Post due" reminder and a hand share.
 */
export async function runGooglePosts(now = new Date()): Promise<GooglePostsResult> {
    if (!(await googleReady())) return { sent: 0, failed: [], skipped: "Google Business Profile not connected" };
    const due = await prisma.post.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now }, channels: { has: GOOGLE }, shares: { none: { channel: GOOGLE } } },
        select: { id: true, googleType: true, mediaType: true, createdById: true },
        orderBy: { scheduledAt: "asc" },
        take: 20,
    });
    const out: GooglePostsResult = { sent: 0, failed: [] };
    for (const p of due) {
        if (googleAutoBlock(p)) continue;
        try {
            await sendPostToGoogle(p.id, { userId: p.createdById, name: AUTO_NAME });
            out.sent++;
        } catch (e) {
            out.failed.push({ id: p.id, error: (e as Error).message });
            // Lost access fails every post the same way — stop instead of hammering Google.
            if (e instanceof GoogleError && /connect again|not connected/.test(e.message)) break;
        }
    }
    return out;
}
