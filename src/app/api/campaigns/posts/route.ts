import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { POST_SELECT, postSchema } from "@/modules/campaigns/lib/post";
import { staffName, withMediaLinks } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET  /api/campaigns/posts — the queue: drafts and scheduled posts (soonest
 *      first, undated last), then the last 60 done ones. A small shop's posts
 *      are a short list, so no paging yet.
 * POST /api/campaigns/posts — save a new post.
 */

export async function GET() {
    const { response } = await requirePostsPage();
    if (response) return response;

    const [open, done] = await Promise.all([
        prisma.post.findMany({
            where: { status: { not: "DONE" } },
            select: POST_SELECT,
            orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        }),
        prisma.post.findMany({ where: { status: "DONE" }, select: POST_SELECT, orderBy: { updatedAt: "desc" }, take: 60 }),
    ]);
    return NextResponse.json({ posts: [...open, ...done].map(withMediaLinks) });
}

export async function POST(req: Request) {
    const { user, response } = await requirePostsPage();
    if (response) return response;

    const { data, error } = await validateRequest(req, postSchema);
    if (error) return error;

    try {
        const row = await prisma.post.create({
            data: { ...data, createdById: user.id, createdByName: await staffName(user.id) },
            select: POST_SELECT,
        });
        return NextResponse.json(withMediaLinks(row));
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}
