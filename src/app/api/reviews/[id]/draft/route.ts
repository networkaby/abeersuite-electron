import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireReviewsReply } from "@/modules/reviews/lib/reviewsAccess";
import { saveReviewDraft } from "@/modules/reviews/lib/googleReviews";

// DELETE /api/reviews/[id]/draft — staff throw away an agent's draft reply.
// (Posting it is the normal PUT …/reply, which clears the draft.)
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireReviewsReply();
    if (response) return response;
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad review id" }, { status: 400 });
    try {
        await saveReviewDraft(id, null, null);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to discard the draft");
    }
}
