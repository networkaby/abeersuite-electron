import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const patchSchema = z.object({
    code: z.string().trim().min(1).optional(),
    percentOff: z.coerce.number().int().min(1).max(100).optional().nullable(),
    flatPaise: z.coerce.number().int().min(1).optional().nullable(),
    isActive: z.boolean().optional(),
    expiresAt: z.union([z.string(), z.literal("")]).optional().nullable(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;
    const b = data;
    try {
        const data: Record<string, unknown> = {};
        if (b.code !== undefined) data.code = b.code.toUpperCase();
        if (b.percentOff !== undefined) data.percentOff = b.percentOff;
        if (b.flatPaise !== undefined) data.flatPaise = b.flatPaise;
        if (b.isActive !== undefined) data.isActive = b.isActive;
        if (b.expiresAt !== undefined)
            data.expiresAt =
                b.expiresAt && String(b.expiresAt).trim() !== "" ? new Date(b.expiresAt as string) : null;

        const row = await prisma.shopCoupon.update({
            where: { id },
            data,
        });
        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update coupon");
    }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("ecommerce:manage");
    if (response) return response;
    const { id } = await ctx.params;
    try {
        await prisma.shopCoupon.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete coupon (in use?)");
    }
}
