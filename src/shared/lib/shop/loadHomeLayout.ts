import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizeHomeLayout, type HomeSectionInstance } from "@/shared/lib/shop/homeLayout";

/** Load the org's storefront home section instances, falling back to the code default. */
export async function loadHomeLayout(): Promise<HomeSectionInstance[]> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { storefrontHomeJson: true },
    });
    return normalizeHomeLayout(od?.storefrontHomeJson);
}
