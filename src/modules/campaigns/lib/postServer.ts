import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { R2_MESSAGES_BUCKET } from "@/shared/lib/constants/whatsapp";
import { isR2Configured, putR2 } from "@/shared/lib/storage/r2";
import { buildUrl, isCloudinaryUrl } from "@/shared/lib/cloudinaryImage";
import { productGalleryUrls } from "@/shared/lib/shop/productPublic";
import { POST_SELECT, checkPostMedia, pendingChannels } from "@/modules/campaigns/lib/post";
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

/** Adds the view and download links a post's file needs on screen. */
export function withMediaLinks<T extends { mediaKey: string | null; mediaName: string | null }>(row: T) {
    return { ...row, mediaUrl: mediaLink(row.mediaKey), mediaDownloadUrl: mediaLink(row.mediaKey, row.mediaName, true) };
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
        await putR2(R2_MESSAGES_BUCKET, key, body, type);
        await prisma.post.update({ where: { id: postId }, data: { mediaKey: key, mediaType: type, mediaName: name, mediaSize: body.byteLength } });
        return null;
    } catch (e) {
        console.error("[posts] product photo copy failed", e);
        return "Could not copy the product photo — add one below.";
    }
}

/** One post as the screens want it, or null. */
export async function loadPost(id: number) {
    const row = await prisma.post.findUnique({ where: { id }, select: POST_SELECT });
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
    return { posts, due: posts.filter((p) => p.scheduledAt && p.scheduledAt.getTime() <= now).length };
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
export async function postMediaResponse(postId: number): Promise<NextResponse> {
    const p = await prisma.post.findUnique({ where: { id: postId }, select: { mediaKey: true, mediaType: true } });
    if (!p?.mediaKey) return NextResponse.json({ error: "This post has no photo or video." }, { status: 404 });
    const link = mediaLink(p.mediaKey);
    if (!link) return NextResponse.json({ error: "File storage (R2) is not set up on this server." }, { status: 503 });
    const file = await fetch(link);
    if (!file.ok || !file.body) return NextResponse.json({ error: `Could not read the file (${file.status})` }, { status: 502 });
    return new NextResponse(file.body, {
        headers: { "Content-Type": p.mediaType ?? "application/octet-stream", "Cache-Control": "private, max-age=300" },
    });
}
