import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { couponSchema } from "@/shared/lib/schemas/couponSchemas";

// GET /api/coupons — all coupons (+ rules + redemption count). Read-only to any
// authed user (POS reads it); edits require coupons:manage.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
            include: { rules: true, _count: { select: { redemptions: true } } },
        });
        return NextResponse.json(coupons);
    } catch (e) {
        return handleApiError(e, "Failed to fetch coupons");
    }
}

// POST /api/coupons — create a coupon (+ its include/exclude rules).
export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.COUPONS_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, couponSchema);
    if (error) return error;
    try {
        const { rules, ...fields } = data;
        const coupon = await prisma.coupon.create({
            data: {
                ...fields,
                // singleUse ⇒ a hard total cap of 1 (the engine reads totalUsageLimit).
                totalUsageLimit: fields.singleUse ? 1 : fields.totalUsageLimit ?? null,
                createdById: user!.id,
                rules: rules?.length
                    ? { create: rules.map((r) => ({ kind: r.kind, productId: r.productId ?? null, categoryId: r.categoryId ?? null })) }
                    : undefined,
            },
            include: { rules: true, _count: { select: { redemptions: true } } },
        });
        return NextResponse.json(coupon, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create coupon");
    }
}
