import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { POST_SELECT, newPostSchema } from "@/modules/campaigns/lib/post";
import { copyProductPhoto, loadPost, staffName, withMediaLinks } from "@/modules/campaigns/lib/postServer";
import { requirePostsPage } from "@/modules/campaigns/lib/campaignAccess";

/**
 * GET  /api/campaigns/posts — the queue: drafts and scheduled posts (soonest
 *      first, undated last), then the last 60 done ones. A small shop's posts
 *      are a short list, so no paging yet.
 * POST /api/campaigns/posts — save a new post. `fromProductId` (made from a
 *      shop product) copies that product's photo in; `photoNote` says why not.
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

    const { data, error } = await validateRequest(req, newPostSchema);
    if (error) return error;
    const { fromProductId, ...fields } = data;

    try {
        const row = await prisma.post.create({
            data: { ...fields, createdById: user.id, createdByName: await staffName(user.id) },
            select: POST_SELECT,
        });
        if (!fromProductId) return NextResponse.json(withMediaLinks(row));
        const photoNote = await copyProductPhoto(row.id, fromProductId);
        return NextResponse.json({ ...(photoNote ? withMediaLinks(row) : await loadPost(row.id)), photoNote });
    } catch (e) {
        return handleApiError(e, "Failed to save the post");
    }
}
