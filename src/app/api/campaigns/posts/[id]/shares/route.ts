import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam, validateRequest } from "@/shared/lib/api";
import { POST_CHANNELS } from "@/modules/campaigns/lib/post";
import { loadPost, staffName } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * POST /api/campaigns/posts/:id/shares — { channel } — staff mark that they put
 * the post up on that channel by hand. When every channel the post is meant
 * for has a share, the post turns DONE. A channel can be shared again later.
 */

const schema = z.object({
    channel: z.enum(POST_CHANNELS.map((c) => c.value) as [string, ...string[]]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePostsPage();
    if (response) return response;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const post = await prisma.post.findUnique({ where: { id }, select: { channels: true, shares: { select: { channel: true } } } });
        if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

        const shared = new Set([...post.shares.map((s) => s.channel), data.channel]);
        await prisma.$transaction([
            prisma.postShare.create({ data: { postId: id, channel: data.channel, sharedById: user.id, sharedByName: await staffName(user.id) } }),
            ...(post.channels.every((c) => shared.has(c)) ? [prisma.post.update({ where: { id }, data: { status: "DONE" } })] : []),
        ]);
        return NextResponse.json(await loadPost(id));
    } catch (e) {
        return handleApiError(e, "Failed to save");
    }
}
