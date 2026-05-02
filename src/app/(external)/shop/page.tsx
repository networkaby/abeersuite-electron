import { prisma } from "@/lib/prisma";
import { shopProductToPublic } from "@/lib/shop/product-public";
import ShopHero from "@/modules/external/shop/ShopHero";
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

    return (
        <>
            <ShopHero categories={cats} />
            <ShopCatalogClient
                products={products}
                allCategories={cats}
                initialQuery={sp.q ?? ""}
                initialCategory={initialCategory}
            />
        </>
    );
}
