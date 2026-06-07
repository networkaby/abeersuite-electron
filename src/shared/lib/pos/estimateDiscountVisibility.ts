import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    normalizeEstimateDiscountVisibility,
    type EstimateDiscountVisibility,
} from "@/modules/pos/lib/discountVisibility";

/**
 * Load the org's POS-estimate print discount visibility (server-only; read by the
 * receipt builder). Falls back to all-hidden when unset. Mirrors `loadBarcodeBands`.
 */
export async function loadEstimateDiscountVisibility(): Promise<EstimateDiscountVisibility> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { posEstimateShowDiscountsJson: true },
    });
    return normalizeEstimateDiscountVisibility(od?.posEstimateShowDiscountsJson);
}
