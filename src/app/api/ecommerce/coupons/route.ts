import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const bodySchema = z.object({
    code: z.string().trim().min(1),
    percentOff: z.coerce.number().int().min(1).max(100).optional().nullable(),
    flatPaise: z.coerce.number().int().min(1).optional().nullable(),
    isActive: z.boolean().optional(),
    expiresAt: z.union([z.string(), z.literal("")]).optional().nullable(),
}).refine((d) => d.percentOff != null || d.flatPaise != null, {
    message: "Set percentOff or flatPaise",
});

export async function GET() {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    try {
        const rows = await prisma.shopCoupon.findMany({ orderBy: { createdAt: "desc" } });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to list coupons");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;
    const b = data;
    try {
        const row = await prisma.shopCoupon.create({
            data: {
                code: b.code.toUpperCase(),
                percentOff: b.percentOff ?? null,
                flatPaise: b.flatPaise ?? null,
                isActive: b.isActive ?? true,
                expiresAt:
                    b.expiresAt && String(b.expiresAt).trim() !== ""
                        ? new Date(b.expiresAt as string)
                        : null,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create coupon (duplicate code?)");
    }
}
