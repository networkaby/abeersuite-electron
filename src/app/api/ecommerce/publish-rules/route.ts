import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { normalizeShopPublishRules } from "@/modules/ecommerce/lib/shopQualification";

// Owner-configurable shop publish rules — which product fields are mandatory
// before a product can be listed in /shop. Stored on OrgDefaults (singleton id=1).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rules = await loadShopPublishRules();
        return NextResponse.json({ rules });
    } catch (e) {
        return handleApiError(e, "Failed to load publish rules");
    }
}

const putSchema = z.object({
    image: z.boolean().optional(),
    description: z.boolean().optional(),
    price: z.boolean().optional(),
    category: z.boolean().optional(),
    brand: z.boolean().optional(),
    mrp: z.boolean().optional(),
    stock: z.boolean().optional(),
    weight: z.boolean().optional(),
});

export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        // Merge the partial update over the current rules, then store the
        // normalized full object so the column is always well-formed.
        const current = await loadShopPublishRules();
        const rules = normalizeShopPublishRules({ ...current, ...data });
        await prisma.orgDefaults.update({
            where: { id: 1 },
            data: { shopPublishRulesJson: rules },
        });
        return NextResponse.json({ rules });
    } catch (e) {
        return handleApiError(e, "Failed to save publish rules");
    }
}
