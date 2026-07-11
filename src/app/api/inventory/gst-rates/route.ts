import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { unstable_cache, revalidateTag } from "next/cache";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";

export const GST_RATES_TAG = "gst-rates";

const createSchema = z.object({
    rate:        z.number().min(0).max(100),
    label:       z.string().trim().min(1).max(64),
    description: z.string().trim().optional().nullable(),
    isActive:    z.boolean().optional(),
});

const getGstRatesCached = unstable_cache(
    async () => prisma.gstRate.findMany({ orderBy: { rate: "asc" } }),
    ["gst-rates:list"],
    { tags: [GST_RATES_TAG], revalidate: 3600 },
);

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        return NextResponse.json(await getGstRatesCached());
    } catch (e) {
        return handleApiError(e, "Failed to fetch GST rates");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const row = await prisma.gstRate.create({
            data: {
                rate:        data.rate,
                label:       data.label,
                description: data.description ?? null,
                isActive:    data.isActive ?? true,
            },
        });
        revalidateTag(GST_RATES_TAG, { expire: 0 });
        return NextResponse.json(row, { status: 201 });
    } catch (e) {
        const conflict = prismaUniqueError(e, "Label already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create GST rate");
    }
}
