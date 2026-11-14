import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { parkInAttention } from "@/modules/ecommerce/lib/shopAttention";

// POST /api/ecommerce/products/attention { ids, reason } — park Draft products in
// the Attention stage (owner, 2026-11-11): work blocked until something is
// checked by hand. Only Draft products move; the rest are named back.
// Leaving Attention is Save as draft / Save as ready on the product (PATCH).

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    reason: z.string().trim().min(1).max(1000),
});

export async function POST(req: Request) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = (await prisma.user.findUnique({ where: { id: mod.user.id }, select: { name: true } }))?.name ?? "Staff";
        return NextResponse.json(await parkInAttention(data.ids, data.reason, by, ["DRAFT"]));
    } catch (e) {
        return handleApiError(e, "Could not park in Attention");
    }
}
