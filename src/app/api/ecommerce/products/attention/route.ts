import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModuleAccess, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// Attention (owner, 2026-11-11): flag products with a problem — photo wrong,
// data clash, price doubt — so Draft keeps only real edits. The flag sits beside
// the stage; Resolve (reason null) clears it and the product shows its stage again.
// One route for a single row and for ticked rows.

const schema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    /** The problem in a few words; null = Resolve. */
    reason: z.string().trim().min(1).max(1000).nullable(),
});

export async function POST(req: Request) {
    const mod = await requireModuleAccess("e-commerce");
    if (mod.response) return mod.response;
    const gate = await requirePermission(PERMISSIONS.ECOMMERCE_PRODUCT_ATTENTION);
    if (gate.response) return gate.response;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const by = data.reason
            ? (await prisma.user.findUnique({ where: { id: gate.user.id }, select: { name: true } }))?.name ?? "Staff"
            : null;
        const res = await prisma.invProduct.updateMany({
            where: { id: { in: data.ids } },
            data: data.reason
                ? { shopAttention: data.reason, shopAttentionAt: new Date(), shopAttentionBy: by }
                : { shopAttention: null, shopAttentionAt: null, shopAttentionBy: null },
        });
        return NextResponse.json({ count: res.count });
    } catch (e) {
        return handleApiError(e, "Could not update attention");
    }
}
