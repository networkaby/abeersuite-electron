import { prisma } from "@/shared/lib/prisma/prismaClient";
import BrandStripView from "./BrandStripView";

/**
 * Storefront brand strip — fetches the active, logo-bearing brands and hands
 * them to BrandStripView, which owns the markup (and is reused by the
 * Customize Home live preview).
 */
export default async function BrandStrip({
    eyebrow,
    title,
}: {
    eyebrow?: string;
    title?: string;
} = {}) {
    const brands = await prisma.invBrand.findMany({
        where: {
            isActive: true,
            imageUrl: { not: null },
            products: { some: { isListedInShop: true, isActive: true } },
        },
        select: { name: true, imageUrl: true, slug: true },
        orderBy: { name: "asc" },
    });
    return <BrandStripView brands={brands} eyebrow={eyebrow} title={title} />;
}
