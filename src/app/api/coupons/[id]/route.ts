import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError, parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { couponUpdateSchema } from "@/shared/lib/schemas/couponSchemas";

// PATCH /api/coupons/[id] — edit fields (incl. the discount value) and/or replace
// the include/exclude rules.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.COUPONS_EDIT);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, couponUpdateSchema);
    if (error) return error;

    try {
        const { rules, ...fields } = data;
        // Keep totalUsageLimit consistent when singleUse is toggled on.
        const totalUsageLimit = fields.singleUse === true ? 1 : fields.totalUsageLimit;
        const coupon = await prisma.coupon.update({
            where: { id },
            data: {
                ...fields,
                ...(totalUsageLimit !== undefined ? { totalUsageLimit } : {}),
                // When `rules` is sent, replace the whole set atomically.
                ...(rules
                    ? { rules: { deleteMany: {}, create: rules.map((r) => ({ kind: r.kind, productId: r.productId ?? null, categoryId: r.categoryId ?? null })) } }
                    : {}),
            },
            include: { rules: true, _count: { select: { redemptions: true } } },
        });
        return NextResponse.json(coupon);
    } catch (e) {
        return handleApiError(e, "Failed to update coupon");
    }
}

// DELETE /api/coupons/[id] — hard delete if never redeemed, else soft-disable
// (keep the row so historical CouponRedemption references stay intact).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.COUPONS_DELETE);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    try {
        const used = await prisma.couponRedemption.count({ where: { couponId: id } });
        if (used > 0) {
            await prisma.coupon.update({ where: { id }, data: { isActive: false } });
            return NextResponse.json({ ok: true, softDisabled: true });
        }
        await prisma.coupon.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete coupon");
    }
}
