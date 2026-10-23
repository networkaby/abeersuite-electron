import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { mediaLink } from "@/modules/message/lib/customerMessages";
import { POST_SELECT } from "@/modules/campaigns/lib/post";

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
