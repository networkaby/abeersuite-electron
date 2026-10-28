import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { incomingSettings, requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { coworkReplyMode, coworkRules } from "@/modules/incoming/lib/incomingCatalog";

// GET /api/agent/reviews?replied=no|yes|all&limit=50 — for the Cowork agent
// (x-api-key = the Cowork key on Settings → Incoming API). Our saved copy of the
// shop's reviews, newest first, plus the reply rules and mode set on that page.
// Default: only reviews with no reply yet.

export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "COWORK"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
        const q = new URL(req.url).searchParams;
        const replied = q.get("replied") ?? "no";
        const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 50));
        const where: Prisma.ReviewWhereInput = replied === "no" ? { replyText: null } : replied === "yes" ? { replyText: { not: null } } : {};
        const [rows, settings] = await Promise.all([
            prisma.review.findMany({
                where,
                orderBy: { reviewedAt: "desc" },
                take: limit,
                select: {
                    id: true, platform: true, reviewerName: true, stars: true, comment: true, reviewedAt: true,
                    replyText: true, repliedAt: true, draftText: true, draftByName: true, draftedAt: true,
                },
            }),
            incomingSettings("COWORK"),
        ]);
        return NextResponse.json({
            replyMode: coworkReplyMode(settings),
            rules: coworkRules(settings),
            note: "1–2 star reviews are always saved as a draft for staff, whatever the mode.",
            reviews: rows,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load reviews");
    }
}
