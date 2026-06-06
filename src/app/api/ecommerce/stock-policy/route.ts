import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";

// Owner-configurable org-wide out-of-stock policy (Settings → E-Commerce). A
// per-product InvProduct.allowBackorder overrides it to always allow ordering.

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    try {
        const policy = await loadShopStockPolicy();
        return NextResponse.json({ policy });
    } catch (e) {
        return handleApiError(e, "Failed to load stock policy");
    }
}

const putSchema = z.object({ policy: z.enum(["HIDE", "NOTIFY", "BACKORDER"]) });

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ECOMMERCE_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        await prisma.orgDefaults.update({
            where: { id: 1 },
            data: { shopOutOfStockPolicy: data.policy },
        });
        return NextResponse.json({ policy: data.policy });
    } catch (e) {
        return handleApiError(e, "Failed to save stock policy");
    }
}
