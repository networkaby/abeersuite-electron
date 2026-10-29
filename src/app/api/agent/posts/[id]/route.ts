import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, parseIdParam } from "@/shared/lib/api";
import { postSchema } from "@/modules/campaigns/lib/post";
import { loadPost } from "@/modules/campaigns/lib/postServer";
import { agentGate, agentPostMode, agentStatus, ownOpenPost, readAgentPost } from "@/modules/campaigns/lib/agentPosts";

/**
 * PATCH  /api/agent/posts/:id — the Cowork agent rewrites one of its own posts
 *        (the whole post, as POST ../ takes it), until any channel has it.
 * DELETE /api/agent/posts/:id — removes one of its own posts, on the same rule.
 */

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const denied = await agentGate(req);
    if (denied) return denied;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const own = await ownOpenPost(id);
    if (own.error) return own.error;
    const { data, asked, error } = await readAgentPost(req, postSchema);
    if (error) return error;
    try {
        const mode = await agentPostMode();
        await prisma.post.update({ where: { id }, data: { ...data, status: agentStatus(mode, data.status as "DRAFT" | "SCHEDULED", asked) } });
        return NextResponse.json({ mode, post: await loadPost(id) });
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const denied = await agentGate(req);
    if (denied) return denied;
    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;
    const own = await ownOpenPost(id);
    if (own.error) return own.error;
    try {
        await prisma.post.delete({ where: { id } });
        return new NextResponse(null, { status: 204 });
    } catch (e) {
        return handleApiError(e, "Failed to delete the post");
    }
}
