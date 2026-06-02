import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loyaltyEarnRuleSchema } from "@/shared/lib/schemas/loyaltySchemas";

const ruleInclude = {
    category: { select: { id: true, name: true } },
    group:    { select: { id: true, name: true } },
    product:  { select: { id: true, name: true, sku: true } },
} as const;

// GET /api/loyalty/earn-rules — all earn-rule overrides (with target names).
export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    try {
        const rules = await prisma.loyaltyEarnRule.findMany({
            orderBy: [{ scope: "asc" }, { id: "asc" }],
            include: ruleInclude,
        });
        return NextResponse.json(rules);
    } catch (e) {
        return handleApiError(e, "Failed to fetch earn rules");
    }
}

// POST /api/loyalty/earn-rules — create a multiplier override.
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.LOYALTY_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, loyaltyEarnRuleSchema);
    if (error) return error;

    try {
        const rule = await prisma.loyaltyEarnRule.create({
            data: {
                scope:      data.scope,
                categoryId: data.categoryId ?? null,
                groupId:    data.groupId ?? null,
                productId:  data.productId ?? null,
                multiplier: data.multiplier,
                redeemCapPct: data.redeemCapPct ?? null,
                enabled:    data.enabled ?? true,
            },
            include: ruleInclude,
        });
        return NextResponse.json(rule, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create earn rule (a rule for this target may already exist)");
    }
}
