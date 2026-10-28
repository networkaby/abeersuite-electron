import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { requireReviewsPage } from "@/modules/reviews/lib/reviewsAccess";
import { googleStatus } from "@/modules/campaigns/lib/googleBusiness";

// GET /api/reviews?platform=GOOGLE&stars=1,2&replied=no&page=1 — CRM → Reviews.
// Reads our saved copy only; Google is asked by POST /api/reviews/sync and the
// communications job, never on page open.

const PAGE_SIZE = 30;

export async function GET(req: Request) {
    const { response } = await requireReviewsPage();
    if (response) return response;
    try {
        const q = new URL(req.url).searchParams;
        const page = Math.max(1, Number(q.get("page")) || 1);
        const stars = (q.get("stars") ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 5);
        const replied = q.get("replied");
        const where: Prisma.ReviewWhereInput = {
            ...(q.get("platform") ? { platform: q.get("platform")! } : {}),
            ...(stars.length ? { stars: { in: stars } } : {}),
            ...(replied === "no" ? { replyText: null } : replied === "yes" ? { replyText: { not: null } } : {}),
        };
        const [rows, total, waiting, google] = await Promise.all([
            prisma.review.findMany({
                where,
                orderBy: { reviewedAt: "desc" },
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
                select: {
                    id: true, platform: true, reviewerName: true, reviewerPhoto: true, stars: true, comment: true,
                    reviewedAt: true, replyText: true, repliedAt: true, repliedByName: true, ticketId: true,
                },
            }),
            prisma.review.count({ where }),
            prisma.review.count({ where: { replyText: null } }),
            googleStatus(),
        ]);
        // Where each raised ticket opens — Deals board or the Help Desk ticket.
        const ticketIds = rows.flatMap((r) => (r.ticketId ? [r.ticketId] : []));
        const deals = ticketIds.length
            ? new Set((await prisma.ticketDeal.findMany({ where: { ticketId: { in: ticketIds } }, select: { ticketId: true } })).map((d) => d.ticketId))
            : new Set<number>();
        return NextResponse.json({
            rows: rows.map((r) => ({
                ...r,
                ticketHref: r.ticketId ? (deals.has(r.ticketId) ? "/office/crm/deals" : `/office/help?ticket=${r.ticketId}`) : null,
            })),
            total,
            pageSize: PAGE_SIZE,
            waiting,
            google: { ready: google.ready, lastError: google.lastError ?? null, setupProblem: google.setupProblem },
        });
    } catch (e) {
        return handleApiError(e, "Failed to load reviews");
    }
}
