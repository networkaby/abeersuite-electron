import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic } from "@/shared/lib/shop/productPublic";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { loadShopGroupIndex } from "@/shared/lib/shop/groupCategory";
import { loadShopPublishRules } from "@/shared/lib/shop/publishRules";
import { loadShopStockPolicy } from "@/shared/lib/shop/stockPolicy";
import { shopQualification } from "@/modules/ecommerce/lib/shopQualification";
import { resolveAvailability } from "@/modules/ecommerce/lib/shopStock";
import { invProductDb } from "@/shared/types/inventoryTypes";
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
    const [bands, rules, policy, groupIndex] = await Promise.all([
        loadBarcodeBands(),
        loadShopPublishRules(),
        loadShopStockPolicy(),
        loadShopGroupIndex(),
    ]);
    const rows = await invProductDb(prisma).findMany({
        where: { isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ shopCategory: "asc" }, { id: "asc" }],
    });
    const products = rows
        .map((p) => ({ p, avail: resolveAvailability(p.stock, p.allowBackorder, policy) }))
        .filter(({ avail }) => avail.visible)
        .map(({ p, avail }) => shopProductToPublic(p, { bands, avail, groupIndex }))
        .filter((p) => shopQualification(p, rules).qualified);
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
