import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { POST_SELECT, pendingChannels } from "@/modules/campaigns/lib/post";
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
 * Log that `userId` put the post up on `channel`; once every channel the post is
 * meant for has a share, it turns DONE. Shared by the office and the phone app.
 * Returns the post as the screens want it, or null when there is no such post.
 */
export async function recordShare(postId: number, channel: string, userId: number) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { channels: true, shares: { select: { channel: true } } } });
    if (!post) return null;
    const shared = new Set([...post.shares.map((s) => s.channel), channel]);
    await prisma.$transaction([
        prisma.postShare.create({ data: { postId, channel, sharedById: userId, sharedByName: await staffName(userId) } }),
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
