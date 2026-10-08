import { prisma } from "@/shared/lib/prisma/prismaClient";

/** Active brands with a logo and something listed in the shop — the website's
 *  brand strip and the customer app's "Shop by brand" both show these. */
export function loadShopBrands() {
    return prisma.invBrand.findMany({
        where: {
            isActive: true,
            imageUrl: { not: null },
            products: { some: { isListedInShop: true, isActive: true } },
        },
        select: { name: true, imageUrl: true, slug: true },
        orderBy: { name: "asc" },
    });
}
