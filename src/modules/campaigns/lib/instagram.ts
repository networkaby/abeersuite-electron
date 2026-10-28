import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { instagramAutoBlock, postCaption } from "@/modules/campaigns/lib/post";
import { FacebookError, graph, noteFacebookError, pageAccess, facebookSetupProblem, FACEBOOK_LINK_ID } from "@/modules/campaigns/lib/facebookPage";
import { claimPostFor, recordShare } from "@/modules/campaigns/lib/postServer";

/**
 * Instagram — the business account linked to the connected Facebook Page,
 * posted to with that page's token (no login of its own; facebookPage.ts).
 * Instagram publishes in two steps: make a media container from the photo /
 * video link (Instagram fetches it from the signed R2 link), wait until a
 * video has been processed, then publish it. A photo is a feed post; an MP4
 * goes up as a Reel. Errors are FacebookError — the same connection fails both.
 */

const INSTAGRAM = "INSTAGRAM";
const AUTO_NAME = "Auto (Instagram)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a video may take to process before we give up on this try (the job tries again next ring). */
const VIDEO_WAIT_MS = 90_000;

type PostForInstagram = { caption: string; link: string | null; mediaKey: string | null; mediaType: string | null };

/** Put one post up on Instagram. Returns its permalink. Throws FacebookError with a readable reason. */
export async function postToInstagram(p: PostForInstagram): Promise<string | null> {
    const block = instagramAutoBlock(p);
    if (block) throw new FacebookError(block);
    const { token, igUserId } = await pageAccess();
    if (!igUserId) throw new FacebookError("No Instagram business account is linked to the picked page — link it in Meta, then Change page on Campaigns → Channels.");
    const url = mediaLink(p.mediaKey);
    if (!url) throw new FacebookError("File storage (R2) is not set up on this server, so Instagram cannot fetch the photo.");

    // Links are not clickable on Instagram, but the shop address still tells people where to look.
    const caption = postCaption(p, COMPANY_DETAILS.sites.shop);
    const video = p.mediaType === "video/mp4";
    try {
        const box = await graph<{ id: string }>(`/${igUserId}/media`, {
            method: "POST",
            params: { ...(video ? { media_type: "REELS", video_url: url } : { image_url: url }), caption, access_token: token },
        });
        if (video) await waitUntilProcessed(box.id, token);
        const made = await graph<{ id: string }>(`/${igUserId}/media_publish`, { method: "POST", params: { creation_id: box.id, access_token: token } });
        const { permalink } = await graph<{ permalink?: string }>(`/${made.id}`, { params: { fields: "permalink", access_token: token } }).catch(() => ({ permalink: undefined }));
        await noteFacebookError(null);
        return permalink ?? null;
    } catch (e) {
        if (e instanceof FacebookError) await noteFacebookError(`Instagram — ${e.message}`);
        throw e;
    }
}

async function waitUntilProcessed(containerId: string, token: string) {
    const until = Date.now() + VIDEO_WAIT_MS;
    while (Date.now() < until) {
        const { status_code } = await graph<{ status_code?: string }>(`/${containerId}`, { params: { fields: "status_code", access_token: token } });
        if (status_code === "FINISHED") return;
        if (status_code === "ERROR" || status_code === "EXPIRED") throw new FacebookError("Instagram could not process the video — check it is an MP4 under 90 seconds, or share by hand.");
        await sleep(4000);
    }
    throw new FacebookError("Instagram is still processing the video — try again in a minute.");
}

const POST_FOR_INSTAGRAM = {
    id: true,
    caption: true,
    link: true,
    channels: true,
    mediaKey: true,
    mediaType: true,
    updatedAt: true,
    shares: { where: { channel: INSTAGRAM }, select: { id: true }, take: 1 },
} as const;

/** Put one post up on Instagram and log the share; `again` posts one already shared there once more. */
export async function sendPostToInstagram(postId: number, by: { userId: number | null; name?: string }, again = false) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: POST_FOR_INSTAGRAM });
    if (!post) return null;
    await claimPostFor(post, INSTAGRAM, "Instagram", again, (m) => new FacebookError(m));
    const url = await postToInstagram(post);
    return { post: await recordShare(postId, INSTAGRAM, by.userId, by.name), url };
}

/** Is Instagram posting set up (Facebook page picked, and it has a linked Instagram)? */
export async function instagramReady(): Promise<boolean> {
    if (facebookSetupProblem()) return false;
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { pageId: true, igUserId: true } });
    return !!row?.pageId && !!row.igUserId;
}

export type InstagramPostsResult = { sent: number; failed: { id: number; error: string }[]; skipped?: string };

/**
 * Scheduled posts whose time has come and that still wait for Instagram — sent
 * by the communications job. One Instagram cannot take by itself (no photo, a
 * PNG / WebP) is left for the "Post due" reminder and a hand share.
 */
export async function runInstagramPosts(now = new Date()): Promise<InstagramPostsResult> {
    if (!(await instagramReady())) return { sent: 0, failed: [], skipped: "Instagram not linked" };
    const due = await prisma.post.findMany({
        where: { status: "SCHEDULED", scheduledAt: { lte: now }, channels: { has: INSTAGRAM }, shares: { none: { channel: INSTAGRAM } } },
        select: { id: true, mediaType: true, createdById: true },
        orderBy: { scheduledAt: "asc" },
        // Each may wait for a video — keep one ring short.
        take: 5,
    });
    const out: InstagramPostsResult = { sent: 0, failed: [] };
    for (const p of due) {
        if (instagramAutoBlock(p)) continue;
        try {
            await sendPostToInstagram(p.id, { userId: p.createdById, name: AUTO_NAME });
            out.sent++;
        } catch (e) {
            out.failed.push({ id: p.id, error: (e as Error).message });
            if (e instanceof FacebookError && /connect again|not connected|No Instagram/.test(e.message)) break;
        }
    }
    return out;
}
