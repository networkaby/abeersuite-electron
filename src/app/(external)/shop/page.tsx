import { prisma } from "@/lib/prisma";
import { shopProductToPublic } from "@/lib/shop/product-public";
import ShopPageBanner from "@/modules/external/shop/ShopPageBanner";
import TrustStrip from "@/modules/external/store/TrustStrip";
import BrandStrip from "@/modules/external/store/BrandStrip";
import ShopCatalogClient from "@/modules/external/shop/ShopCatalogClient";

export default async function ShopCatalogPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; category?: string }>;
}) {
    const sp = await searchParams;
    const initialCategory = sp.category && sp.category !== "" ? sp.category : "all";
    const rows = await prisma.shopProduct.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { id: "asc" }],
    });
    const products = rows.map(shopProductToPublic);
    const cats = [...new Set(products.map((p) => p.category))];

    const categoryPills = cats
        .map((name) => ({
            name,
            count: products.filter((p) => p.category === name).length,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return (
        <>
            <ShopPageBanner
                productCount={products.length}
                categoryPills={categoryPills}
                activeQuery={sp.q?.trim() || undefined}
            />
            <TrustStrip />
            <ShopCatalogClient
                products={products}
                allCategories={cats}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
            />
            <BrandStrip />
        </>
    );
}
