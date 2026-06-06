import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    normalizeShopPublishRules,
    type ShopPublishRules,
} from "@/modules/ecommerce/lib/shopQualification";

/**
 * Load the org's shop publish rules (OrgDefaults.shopPublishRulesJson), falling
 * back to the default gate (image + description + price) when unset. Shared by
 * the storefront product APIs, the SSR shop pages, and the ecommerce product
 * routes so every surface enforces the same owner-chosen bar. Server-only.
 */
export async function loadShopPublishRules(): Promise<ShopPublishRules> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { shopPublishRulesJson: true },
    });
    return normalizeShopPublishRules(od?.shopPublishRulesJson);
}
