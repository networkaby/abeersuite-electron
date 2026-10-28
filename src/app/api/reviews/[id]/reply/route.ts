import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireReviewsReply } from "@/modules/reviews/lib/reviewsAccess";
import { GoogleError } from "@/modules/campaigns/lib/googleBusiness";
import { deleteGoogleReviewReply, replyGoogleReview } from "@/modules/reviews/lib/googleReviews";
import { staffName } from "@/modules/campaigns/lib/postServer";

// PUT    /api/reviews/[id]/reply { comment } — put or change the shop's public reply.
// DELETE /api/reviews/[id]/reply             — take it off.

// Google's own limit on a reply is 4096 characters.
const schema = z.object({ comment: z.string().trim().min(1).max(4096) });

const reviewId = async (ctx: { params: Promise<{ id: string }> }) => {
    const id = Number((await ctx.params).id);
    return Number.isInteger(id) && id > 0 ? id : null;
};

function fail(e: unknown, what: string) {
    if (e instanceof GoogleError) return NextResponse.json({ error: e.message }, { status: 502 });
    return handleApiError(e, what);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireReviewsReply();
    if (response) return response;
    const id = await reviewId(ctx);
    if (!id) return NextResponse.json({ error: "Bad review id" }, { status: 400 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const row = await replyGoogleReview(id, data.comment, await staffName(user.id));
        return row ? NextResponse.json(row) : NextResponse.json({ error: "Review not found" }, { status: 404 });
    } catch (e) {
        return fail(e, "Failed to reply");
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireReviewsReply();
    if (response) return response;
    const id = await reviewId(ctx);
    if (!id) return NextResponse.json({ error: "Bad review id" }, { status: 400 });
    try {
        const row = await deleteGoogleReviewReply(id);
        return row ? NextResponse.json(row) : NextResponse.json({ error: "Review not found" }, { status: 404 });
    } catch (e) {
        return fail(e, "Failed to remove the reply");
    }
}
