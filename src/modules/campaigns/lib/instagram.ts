import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { channelOf, channelText, instagramAutoBlock, instagramReelBlock, instagramStoryBlock } from "@/modules/campaigns/lib/post";
import { FacebookError, graph, noteFacebookError, pageAccess, facebookSetupProblem, FACEBOOK_LINK_ID } from "@/modules/campaigns/lib/facebookPage";
import { COPY_SELECT, asChannelCopy, channelDue, claimPostFor, recordShare } from "@/modules/campaigns/lib/postServer";

/**
 * Instagram — the business account linked to the connected Facebook Page,
 * posted to with that page's token (no login of its own; facebookPage.ts).
 * Instagram publishes in two steps: make a media container from the photo /
 * video link (Instagram fetches it from the signed R2 link), wait until a
 * video has been processed, then publish it. Three channels (owner,
 * 2026-10-30: "cover all possible features"):
 *   INSTAGRAM        the feed — 1 photo, or 2–10 photos / MP4s as a carousel
 *                    (a single MP4 can only go up as a Reel);
 *   INSTAGRAM_STORY  each photo / MP4 its own story, in order, no caption;
 *   INSTAGRAM_REEL   one MP4 with its caption, shared to the profile grid.
 * The caption says "Link in bio" — links are not clickable on Instagram.
 * Errors are FacebookError — the same connection fails both networks.
 */

const INSTAGRAM = "INSTAGRAM";
const AUTO_NAME = "Auto (Instagram)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a video may take to process before we give up on this try (the job tries again next ring). */
const VIDEO_WAIT_MS = 90_000;

type Item = { key: string; type: string; size: number };
type PostForInstagram = {
    caption: string;
    link: string | null;
    mediaKey: string | null;
    mediaType: string | null;
    mediaSize?: number | null;
    photos?: Item[];
    /** Reel cover: ms into the video. */
    coverMs?: number | null;
    /** Photos' description (alt text). */
    alt?: string | null;
};

const itemsOf = (p: PostForInstagram): Item[] =>
    p.photos?.length ? p.photos : p.mediaKey && p.mediaType ? [{ key: p.mediaKey, type: p.mediaType, size: p.mediaSize ?? 0 }] : [];

async function account() {
    const { token, igUserId } = await pageAccess();
    if (!igUserId) throw new FacebookError("No Instagram business account is linked to the picked page — link it in Meta, then Change page on Campaigns → Channels.");
    return { token, igUserId };
}

const linkOf = (key: string) => {
    const url = mediaLink(key);
    if (!url) throw new FacebookError("File storage (R2) is not set up on this server, so Instagram cannot fetch the photo.");
    return url;
};

/** One container: a photo or video, with Instagram's own params for its kind; waits for a video. */
async function container(igUserId: string, token: string, item: Item, params: Record<string, string>) {
    const url = linkOf(item.key);
    const video = item.type.startsWith("video/");
    const box = await graph<{ id: string }>(`/${igUserId}/media`, {
        method: "POST",
        params: { ...(video ? { video_url: url } : { image_url: url }), ...params, access_token: token },
    });
    if (video) await waitUntilProcessed(box.id, token);
    return box.id;
}

async function publish(igUserId: string, token: string, creationId: string): Promise<string | null> {
    const made = await graph<{ id: string }>(`/${igUserId}/media_publish`, { method: "POST", params: { creation_id: creationId, access_token: token } });
    const { permalink } = await graph<{ permalink?: string }>(`/${made.id}`, { params: { fields: "permalink", access_token: token } }).catch(() => ({ permalink: undefined }));
    return permalink ?? null;
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
        const out = await run();
        await noteFacebookError(null);
        return out;
    } catch (e) {
        if (e instanceof FacebookError) await noteFacebookError(`Instagram — ${e.message}`);
        throw e;
    }
}

/** The feed: one photo, a carousel of 2–10, or one MP4 (as a Reel — the only way Instagram takes a lone video). */
export async function postToInstagram(p: PostForInstagram): Promise<string | null> {
    const block = instagramAutoBlock(p);
    if (block) throw new FacebookError(block);
    const { token, igUserId } = await account();
    const caption = channelText(INSTAGRAM, p.caption, p.link, COMPANY_DETAILS.sites.shop);
    const items = itemsOf(p).slice(0, 10);
    return guarded(async () => {
        if (items.length === 1) {
            const [one] = items;
            const id = await container(igUserId, token, one, one.type.startsWith("video/") ? { media_type: "REELS", caption } : { caption, ...(p.alt ? { alt_text: p.alt } : {}) });
            return publish(igUserId, token, id);
        }
        const children: string[] = [];
        for (const f of items)
            children.push(
                await container(igUserId, token, f, {
                    is_carousel_item: "true",
                    ...(f.type.startsWith("video/") ? { media_type: "VIDEO" } : p.alt ? { alt_text: p.alt } : {}),
                }),
            );
        const parent = await graph<{ id: string }>(`/${igUserId}/media`, {
            method: "POST",
            params: { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token },
        });
        return publish(igUserId, token, parent.id);
    });
}

/**
 * Stories, in order, each its own. Stops at the first failure: none up →
 * throws; some up → says how many, so the share is logged and a retry never
 * posts the first ones twice.
 */
export async function postStoryToInstagram(p: PostForInstagram): Promise<{ url: string | null; note: string | null }> {
    const block = instagramStoryBlock(p);
    if (block) throw new FacebookError(block);
    const { token, igUserId } = await account();
    const items = itemsOf(p).slice(0, 10);
    let first: string | null = null;
    let done = 0;
    for (const f of items) {
        try {
            const id = await container(igUserId, token, f, { media_type: "STORIES" });
            first ??= await publish(igUserId, token, id);
            done++;
        } catch (e) {
            if (e instanceof FacebookError) await noteFacebookError(`Instagram — ${e.message}`);
            if (!done) throw e;
            return { url: first, note: `${done} of ${items.length} Instagram stories went up; story ${done + 1} failed: ${(e as Error).message} Share the rest by hand.` };
        }
    }
    await noteFacebookError(null);
    return { url: first, note: null };
}

/** One MP4 as a Reel, with its caption, also shown on the profile grid. */
export async function postReelToInstagram(p: PostForInstagram): Promise<string | null> {
    const block = instagramReelBlock(p);
    if (block) throw new FacebookError(block);
    const { token, igUserId } = await account();
    const caption = channelText("INSTAGRAM_REEL", p.caption, p.link, COMPANY_DETAILS.sites.shop);
    const [video] = itemsOf(p);
    return guarded(async () =>
        publish(
            igUserId,
            token,
            await container(igUserId, token, video, {
                media_type: "REELS",
                caption,
                share_to_feed: "true",
                ...(p.coverMs != null ? { thumb_offset: String(p.coverMs) } : {}),
            }),
        ),
    );
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

type Copy = ReturnType<typeof asChannelCopy<Parameters<typeof asChannelCopy>[0]>>;
const plain = (url: string | null) => ({ url, note: null as string | null });

/** The three Instagram channels: how each goes up and what stops it going by itself. */
const INSTAGRAM_CHANNELS: Record<string, { send: (p: Copy) => Promise<{ url: string | null; note: string | null }>; block: (p: Copy) => string | null }> = {
    INSTAGRAM: { send: async (p) => plain(await postToInstagram(p as never)), block: (p) => instagramAutoBlock(p) },
    INSTAGRAM_STORY: { send: (p) => postStoryToInstagram(p as never), block: (p) => instagramStoryBlock(p) },
    INSTAGRAM_REEL: { send: async (p) => plain(await postReelToInstagram(p as never)), block: (p) => instagramReelBlock(p) },
};
export const isInstagramChannel = (c: string) => c in INSTAGRAM_CHANNELS;

const POST_FOR_INSTAGRAM = {
    id: true,
    ...COPY_SELECT,
    link: true,
    channels: true,
    updatedAt: true,
} as const;

/** Put one post up on an Instagram channel and log the share; `again` posts one already shared there once more. */
export async function sendPostToInstagram(postId: number, by: { userId: number | null; name?: string }, again = false, channel = INSTAGRAM) {
    const how = INSTAGRAM_CHANNELS[channel];
    if (!how) throw new FacebookError("Not an Instagram channel.");
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { ...POST_FOR_INSTAGRAM, shares: { where: { channel }, select: { id: true }, take: 1 } },
    });
    if (!post) return null;
    await claimPostFor(post, channel, channelOf(channel)?.label ?? "Instagram", again, (m) => new FacebookError(m));
    // Some stories up and one failed still counts as shared — a retry would post the first ones twice.
    const { url, note } = await how.send(asChannelCopy(post, channel));
    return { post: await recordShare(postId, channel, by.userId, by.name), url, note };
}

/** Is Instagram posting set up (Facebook page picked, and it has a linked Instagram)? */
export async function instagramReady(): Promise<boolean> {
    if (await facebookSetupProblem()) return false;
    const row = await prisma.facebookPageLink.findUnique({ where: { id: FACEBOOK_LINK_ID }, select: { pageId: true, igUserId: true } });
    return !!row?.pageId && !!row.igUserId;
}

export type InstagramPostsResult = { sent: number; failed: { id: number; error: string }[]; skipped?: string };

/**
 * Scheduled posts whose time has come and that still wait for an Instagram
 * channel — sent by the communications job. One Instagram cannot take by
 * itself is left for the "Post due" reminder and a hand share.
 */
export async function runInstagramPosts(now = new Date()): Promise<InstagramPostsResult> {
    if (!(await instagramReady())) return { sent: 0, failed: [], skipped: "Instagram not linked" };
    const out: InstagramPostsResult = { sent: 0, failed: [] };
    for (const [channel, how] of Object.entries(INSTAGRAM_CHANNELS)) {
        const due = await prisma.post.findMany({
            where: { status: "SCHEDULED", scheduledAt: { lte: now }, channels: { has: channel }, shares: { none: { channel } } },
            select: { id: true, ...COPY_SELECT, createdById: true },
            orderBy: { scheduledAt: "asc" },
            // Each may wait for a video — keep one ring short.
            take: 5,
        });
        for (const p of due) {
            if (!channelDue(p, channel, now) || how.block(asChannelCopy(p, channel))) continue;
            try {
                await sendPostToInstagram(p.id, { userId: p.createdById, name: AUTO_NAME }, false, channel);
                out.sent++;
            } catch (e) {
                out.failed.push({ id: p.id, error: (e as Error).message });
                if (e instanceof FacebookError && /connect again|not connected|No Instagram/.test(e.message)) return out;
            }
        }
    }
    return out;
}
