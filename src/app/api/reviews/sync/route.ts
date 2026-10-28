import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireReviewsReply } from "@/modules/reviews/lib/reviewsAccess";
import { GoogleError } from "@/modules/campaigns/lib/googleBusiness";
import { syncGoogleReviews } from "@/modules/reviews/lib/googleReviews";

// POST /api/reviews/sync — Refresh on CRM → Reviews: pull new and changed Google reviews now.
export async function POST() {
    const { response } = await requireReviewsReply();
    if (response) return response;
    try {
        return NextResponse.json(await syncGoogleReviews());
    } catch (e) {
        if (e instanceof GoogleError) return NextResponse.json({ error: e.message }, { status: 502 });
        return handleApiError(e, "Failed to refresh reviews");
    }
}
