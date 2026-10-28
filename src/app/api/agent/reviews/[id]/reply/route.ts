import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { incomingSettings, requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { coworkReplyMode } from "@/modules/incoming/lib/incomingCatalog";
import { GoogleError } from "@/modules/campaigns/lib/googleBusiness";
import { replyGoogleReview, saveReviewDraft } from "@/modules/reviews/lib/googleReviews";

// POST /api/agent/reviews/[id]/reply { text, mode?: "draft" | "post" } — the Cowork
// agent answers a review. It goes live on Google only when the page's mode is
// POST, the agent did not ask for a draft, and the review has 3+ stars;
// otherwise it is kept as a draft for staff on CRM → Reviews.
// Answer: { result: "posted" | "draft", reason? }.

const AGENT_NAME = "Cowork";
const schema = z.object({ text: z.string().trim().min(1).max(4096), mode: z.enum(["draft", "post"]).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad review id" }, { status: 400 });
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const review = await prisma.review.findUnique({ where: { id }, select: { stars: true } });
        if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

        const reason =
            review.stars != null && review.stars <= 2
                ? "1–2 star review: always checked by staff"
                : coworkReplyMode(await incomingSettings("COWORK")) === "DRAFT"
                  ? "Reply mode is Draft on Settings → Incoming API"
                  : data.mode === "draft"
                    ? "Agent asked for a draft"
                    : null;
        if (reason) {
            await saveReviewDraft(id, data.text, AGENT_NAME);
            return NextResponse.json({ result: "draft", reason });
        }
        await replyGoogleReview(id, data.text, AGENT_NAME);
        return NextResponse.json({ result: "posted" });
    } catch (e) {
        if (e instanceof GoogleError) return NextResponse.json({ error: e.message }, { status: 502 });
        return handleApiError(e, "Failed to reply");
    }
}
