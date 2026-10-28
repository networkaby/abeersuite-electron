import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { GOOGLE_V4_API, GoogleError, googleApi, googleListingParent, googleReady } from "@/modules/campaigns/lib/googleBusiness";

/**
 * Google reviews of the shop's listing — copied into Review by the
 * communications job (and Refresh on CRM → Reviews), replied to from there.
 * Same Google connection and scope (business.manage) as posting.
 */

export const GOOGLE = "GOOGLE";

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
// Each page is 50; 10 pages is far beyond a shop's new reviews between two runs.
const MAX_PAGES = 10;

type GoogleReview = {
    name: string;
    reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
    starRating?: string;
    comment?: string;
    createTime: string;
    updateTime: string;
    reviewReply?: { comment?: string; updateTime?: string };
};

export type GoogleReviewsResult = { saved: number; skipped?: string };

/**
 * Pull reviews changed since the newest one we hold, newest first, and save
 * them. A first run takes the last MAX_PAGES × 50. Safe to repeat.
 */
export async function syncGoogleReviews(): Promise<GoogleReviewsResult> {
    if (!(await googleReady())) return { saved: 0, skipped: "Google Business Profile not connected" };
    const parent = await googleListingParent();
    if (!parent) return { saved: 0, skipped: "No listing picked" };

    const newest = await prisma.review.findFirst({ where: { platform: GOOGLE }, orderBy: { sourceUpdatedAt: "desc" }, select: { sourceUpdatedAt: true } });
    const since = newest?.sourceUpdatedAt.getTime() ?? 0;

    let saved = 0;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc", ...(pageToken ? { pageToken } : {}) });
        const res = await googleApi<{ reviews?: GoogleReview[]; nextPageToken?: string }>(`${GOOGLE_V4_API}/${parent}/reviews?${q}`);
        const fresh = (res.reviews ?? []).filter((r) => new Date(r.updateTime).getTime() > since);
        for (const r of fresh) {
            const data = {
                reviewerName: r.reviewer?.isAnonymous ? null : r.reviewer?.displayName ?? null,
                reviewerPhoto: r.reviewer?.profilePhotoUrl ?? null,
                stars: r.starRating ? STARS[r.starRating] ?? null : null,
                comment: r.comment ?? null,
                reviewedAt: new Date(r.createTime),
                sourceUpdatedAt: new Date(r.updateTime),
                replyText: r.reviewReply?.comment ?? null,
                repliedAt: r.reviewReply?.updateTime ? new Date(r.reviewReply.updateTime) : null,
            };
            // repliedByName stays: Google does not say who replied, only we know.
            await prisma.review.upsert({
                where: { platform_externalId: { platform: GOOGLE, externalId: r.name } },
                create: { platform: GOOGLE, externalId: r.name, ...data },
                update: { ...data, ...(data.replyText ? {} : { repliedByName: null }) },
            });
            saved++;
        }
        // Sorted newest-changed first: once a page has old ones, the rest are old too.
        if (fresh.length < (res.reviews?.length ?? 0) || !res.nextPageToken) break;
        pageToken = res.nextPageToken;
    }
    return { saved };
}

/** Put (or change) the shop's public reply on a Google review. */
export async function replyGoogleReview(reviewId: number, comment: string, byName: string | null) {
    const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { platform: true, externalId: true } });
    if (!review) return null;
    if (review.platform !== GOOGLE) throw new GoogleError("Replying is only wired for Google reviews.");
    const made = await googleApi<{ comment?: string; updateTime?: string }>(`${GOOGLE_V4_API}/${review.externalId}/reply`, {
        method: "PUT",
        body: JSON.stringify({ comment }),
    });
    return prisma.review.update({
        where: { id: reviewId },
        data: { replyText: made.comment ?? comment, repliedAt: made.updateTime ? new Date(made.updateTime) : new Date(), repliedByName: byName },
    });
}

/** Take the shop's reply off a Google review. */
export async function deleteGoogleReviewReply(reviewId: number) {
    const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { platform: true, externalId: true } });
    if (!review) return null;
    if (review.platform !== GOOGLE) throw new GoogleError("Replying is only wired for Google reviews.");
    await googleApi(`${GOOGLE_V4_API}/${review.externalId}/reply`, { method: "DELETE" });
    return prisma.review.update({ where: { id: reviewId }, data: { replyText: null, repliedAt: null, repliedByName: null } });
}
