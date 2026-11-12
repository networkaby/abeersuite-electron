import "server-only";
import { NextResponse } from "next/server";
// Posts read the server, not a counter's local copy: a post saved a moment ago is not there yet
// ("Post not found" on its photo upload), so it went out text-only. Only the screen's own
// GET reads the local copy (loadPost(id, prismaRouted)) and refreshes when the copy has it.
import { prismaAuthoritative as prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { isR2Configured, messagesBucket, putR2 } from "@/shared/lib/storage/r2";
import { buildUrl, isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { POST_SELECT, channelPost, variantOf, checkPostMedia, pendingChannels, postPhotos, type PostPhoto, type PostVariants } from "@/modules/campaigns/lib/post";
import { PHONE_POST_CHANNELS } from "@/modules/mobile/lib/mobilePosts";

/**
 * A post's photo / video lives in the same private R2 bucket as WhatsApp chat
 * attachments, under its own prefix, shown through the same cache-friendly
 * signed links (mediaLink).
 */
export const postMediaPrefix = (postId: number) => `posts/${postId}/`;

export function postMediaKey(postId: number, fileName: string): string {
    const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
    return `${postMediaPrefix(postId)}${Date.now().toString(36)}-${safe}`;
}

/** Adds the view and download links a post's files need on screen — the main one, and every photo by key. */
export function withMediaLinks<T extends { mediaKey: string | null; mediaType: string | null; mediaName: string | null; mediaSize: number | null; extraMedia: unknown; variants: unknown }>(row: T) {
    const photoLinks = Object.fromEntries(
        postPhotos(row).map((f) => [f.key, { url: mediaLink(f.key), downloadUrl: mediaLink(f.key, f.name, true) }]),
    );
    return {
        ...row,
        extraMedia: postPhotos({ ...row, mediaKey: null }) as PostPhoto[],
        variants: (row.variants ?? {}) as PostVariants,
        mediaUrl: mediaLink(row.mediaKey),
        mediaDownloadUrl: mediaLink(row.mediaKey, row.mediaName, true),
        photoLinks,
    };
}

/**
 * Give a new post the main photo of the product it was made from: read it once
 * (from Cloudinary as a square, the staff crop kept, at most PHOTO_PX wide) and
 * store our own copy under the post, so later edits to the product never change
 * a post already shared. Returns why it was skipped, or null when attached — a
 * skipped photo never fails the save; staff add one by hand.
 */
const PHOTO_PX = 1200;

export async function copyProductPhoto(postId: number, productId: number): Promise<string | null> {
    const p = await prisma.invProduct.findUnique({ where: { id: productId }, select: { imageUrl: true, galleryJson: true } });
    const src = p && productGalleryUrls(p.galleryJson, p.imageUrl)[0];
    if (!src || !/^https?:\/\//.test(src)) return "The product has no photo — add one below.";
    if (!isR2Configured()) return "File storage (R2) is not set up on this server — add the photo below.";
    try {
        // JPEG / PNG only: Cloudinary's f_auto would otherwise send WebP or AVIF, and
        // WhatsApp can take a shared WebP for a sticker.
        const res = await fetch(isCloudinaryUrl(src) ? buildUrl(src, { width: PHOTO_PX, frame: "square" }) : src, {
            headers: { Accept: "image/jpeg,image/png" },
        });
        if (!res.ok) return `Could not read the product photo (${res.status}) — add one below.`;
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        const body = await res.arrayBuffer();
        const bad = checkPostMedia(type, body.byteLength);
        if (bad) return `Product photo skipped: ${bad}`;
        const name = `product-${productId}.${type.split("/")[1]}`;
        const key = postMediaKey(postId, name);
        await putR2(messagesBucket(), key, body, type);
        await prisma.post.update({ where: { id: postId }, data: { mediaKey: key, mediaType: type, mediaName: name, mediaSize: body.byteLength } });
        return null;
    } catch (e) {
        console.error("[posts] product photo copy failed", e);
        return "Could not copy the product photo — add one below.";
    }
}

/** The fields a channel's own copy is worked out from (post.ts `channelPost`). */
export const COPY_SELECT = {
    caption: true,
    hashtags: true,
    scheduledAt: true,
    mediaKey: true,
    mediaType: true,
    mediaName: true,
    mediaSize: true,
    extraMedia: true,
    variants: true,
} as const;

/**
 * The post as one network's API gets it: that channel's text, its first photo
 * in the main-photo fields the one-photo senders read, and every photo it has
 * (`photos`) for those that post several (Facebook).
 */
export function asChannelCopy<T extends Parameters<typeof channelPost>[0]>(post: T, channel: string): T {
    const cp = channelPost(post, channel);
    const photo = cp.photos[0] ?? null;
    const v = variantOf(post, channel);
    return {
        ...post,
        caption: cp.caption,
        mediaKey: photo?.key ?? null,
        mediaType: photo?.type ?? null,
        mediaSize: photo?.size ?? null,
        photos: cp.photos,
        coverMs: v?.coverMs ?? null,
        alt: v?.alt ?? null,
    };
}

/** Has this channel's own time come? A copy may run later than the post's first time. */
export const channelDue = (post: Parameters<typeof channelPost>[0], channel: string, now: Date) =>
    (channelPost(post, channel).scheduledAt?.getTime() ?? Infinity) <= now.getTime();

/** One post as the screens want it, or null. `db` = the local copy for a plain screen read. */
export async function loadPost(id: number, db: typeof prisma = prisma) {
    const row = await db.post.findUnique({ where: { id }, select: POST_SELECT });
    return row && withMediaLinks(row);
}

/** The signed-in staff member's name, for the "by" on a post or a share. */
export async function staffName(userId: number): Promise<string | null> {
    return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;
}

/**
 * Posts still waiting for a WhatsApp channel (Channel / Status) — what a phone
 * has to share by hand: due first, then coming, then undated, and how many are
 * due now. The staff app's Posts screen and its Home card both read this.
 */
export async function whatsappWaiting() {
    const rows = await prisma.post.findMany({
        where: { status: { not: "DONE" }, channels: { hasSome: [...PHONE_POST_CHANNELS] } },
        select: POST_SELECT,
        orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
    const posts = rows.filter((p) => pendingChannels(p).some((c) => (PHONE_POST_CHANNELS as readonly string[]).includes(c))).map(withMediaLinks);
    const now = Date.now();
    const isDue = (p: (typeof posts)[number]) =>
        pendingChannels(p).some((c) => (PHONE_POST_CHANNELS as readonly string[]).includes(c) && (channelPost(p, c).scheduledAt?.getTime() ?? Infinity) <= now);
    return { posts, due: posts.filter(isDue).length };
}

/**
 * Before an API post (Google, Facebook): the loaded post must be meant for
 * `channel` and — unless `again` — not yet shared there (`shares` = its shares
 * on that channel). It is claimed by moving its updatedAt in a guarded update,
 * so a button racing the communications job (or a double click) sends it once.
 * Throws `fail(reason)` with words staff can read.
 */
export async function claimPostFor(
    post: { id: number; updatedAt: Date; channels: string[]; shares: unknown[] },
    channel: string,
    label: string,
    again: boolean,
    fail: (msg: string) => Error,
): Promise<void> {
    if (!post.channels.includes(channel)) throw fail(`This post is not meant for ${label} — tick it under channels first.`);
    if (post.shares.length && !again) throw fail(`Already posted on ${label}.`);
    const { count } = await prisma.post.updateMany({ where: { id: post.id, updatedAt: post.updatedAt }, data: { updatedAt: new Date() } });
    if (!count) throw fail("This post is being sent or was just changed — refresh and try again.");
}

/**
 * Log that `userId` put the post up on `channel` (`byName` overrides the name —
 * "Auto (Google)" for the communications job); once every channel the post is
 * meant for has a share, it turns DONE. Shared by the office and the phone app.
 * Returns the post as the screens want it, or null when there is no such post.
 */
export async function recordShare(postId: number, channel: string, userId: number | null, byName?: string) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { channels: true, shares: { select: { channel: true } } } });
    if (!post) return null;
    const shared = new Set([...post.shares.map((s) => s.channel), channel]);
    await prisma.$transaction([
        prisma.postShare.create({ data: { postId, channel, sharedById: userId, sharedByName: byName ?? (userId ? await staffName(userId) : null) } }),
        ...(post.channels.every((c) => shared.has(c)) ? [prisma.post.update({ where: { id: postId }, data: { status: "DONE" } })] : []),
    ]);
    return loadPost(postId);
}

/**
 * The post's file itself, from our own site. A share sheet (browser or the
 * staff app's native share) needs the bytes, and the R2 bucket's CORS lets a
 * page show a signed link but not read it from script.
 */
export async function postMediaResponse(postId: number, key?: string | null): Promise<NextResponse> {
    const p = await prisma.post.findUnique({ where: { id: postId }, select: { mediaKey: true, mediaType: true, mediaName: true, mediaSize: true, extraMedia: true } });
    // The main photo, or one of the post's own photos by key — never another post's file.
    const file = p && (key ? postPhotos(p).find((f) => f.key === key) : postPhotos(p)[0]);
    if (!file) return NextResponse.json({ error: "This post has no such photo or video." }, { status: 404 });
    const link = mediaLink(file.key);
    if (!link) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });
    const res = await fetch(link);
    if (!res.ok || !res.body) return NextResponse.json({ error: `Could not read the file (${res.status})` }, { status: 502 });
    return new NextResponse(res.body, {
        headers: { "Content-Type": file.type || "application/octet-stream", "Cache-Control": "private, max-age=300" },
    });
}
