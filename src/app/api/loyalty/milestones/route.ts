import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyMilestoneSchema } from "@/shared/lib/schemas/loyaltySchemas";

// GET /api/loyalty/milestones — all milestone tiers (+ award counts).
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    try {
        const tiers = await prisma.loyaltyMilestone.findMany({
            orderBy: { threshold: "asc" },
            include: { _count: { select: { awards: true } } },
        });
        return NextResponse.json(tiers);
    } catch (e) {
        return handleApiError(e, "Failed to fetch milestones");
    }
}

// POST /api/loyalty/milestones — create a lifetime-spend tier.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, loyaltyMilestoneSchema);
    if (error) return error;

    try {
        const tier = await prisma.loyaltyMilestone.create({
            data: {
                threshold:   data.threshold,
                bonusPoints: data.bonusPoints,
                label:       data.label ?? null,
                enabled:     data.enabled ?? true,
                issuesCouponTemplateId: data.issuesCouponTemplateId ?? null,
            },
            include: { _count: { select: { awards: true } } },
        });
        return NextResponse.json(tier, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create milestone");
    }
}
