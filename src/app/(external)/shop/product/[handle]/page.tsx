import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { invProductToPublic as shopProductToPublic, productPath } from "@/shared/lib/shop/productPublic";
import { invProductDb } from "@/shared/types/inventoryTypes";
import ProductGallery from "@/modules/external/shop/ProductGallery";
import ProductPurchasePanel from "@/modules/external/shop/ProductPurchasePanel";
import ProductDetailTabs from "@/modules/external/shop/ProductDetailTabs";
import ProductCard from "@/modules/external/shop/ProductCard";
import { ChevronRight } from "lucide-react";

async function loadProduct(handle: string) {
    const decoded = decodeURIComponent(handle);
    const db = invProductDb(prisma);
    if (/^\d+$/.test(decoded)) {
        const id = parseInt(decoded, 10);
        const p = await db.findFirst({
            where: { id, isListedInShop: true, isActive: true },
            include: { category: { select: { name: true } } },
        });
        return p ? shopProductToPublic(p) : null;
    }
    const p = await db.findFirst({
        where: { slug: decoded, isListedInShop: true, isActive: true },
        include: { category: { select: { name: true } } },
    });
    return p ? shopProductToPublic(p) : null;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ handle: string }>;
}): Promise<Metadata> {
    const { handle } = await params;
    const p = await loadProduct(handle);
    if (!p) return { title: "Product" };

    const description = p.subheading ?? p.description ?? undefined;
    // A product is reachable by numeric id AND by slug. Point both at the slug
    // form so the two URLs are not indexed as two products.
    const canonical = productPath(p);
    const image = p.galleryUrls[0] ?? p.imageUrl ?? undefined;

    return {
        // Just the product name — the root template appends the brand, and
        // "· Shop" in between only eats characters Google will truncate.
        title: p.name,
        description,
        alternates: { canonical },
        openGraph: {
            type: "website",
            title: p.name,
            description,
            url: canonical,
            // The product's own photo beats the generic store card here — this
            // is the one page where the share preview should show the thing
            // being sold.
            images: image ? [image] : undefined,
        },
    };
}

export default async function ShopProductPage({ params }: { params: Promise<{ handle: string }> }) {
    const { handle } = await params;
    const product = await loadProduct(handle);
    if (!product) notFound();

    const related = await invProductDb(prisma).findMany({
        where: {
            isListedInShop: true,
            isActive: true,
            shopCategory: product.category,
            NOT: { id: product.id },
        },
        include: { category: { select: { name: true } } },
        orderBy: { id: "asc" },
    });

    const canonicalPath = productPath(product);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
            <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground mb-8">
                <Link href="/shop" className="hover:text-foreground">
                    Shop
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <Link href={`/shop#cat-${encodeURIComponent(product.category)}`} className="hover:text-foreground">
                    {product.category}
                </Link>
                <ChevronRight className="size-4 opacity-60" />
                <span className="text-foreground font-medium line-clamp-1">{product.name}</span>
            </nav>

            {product.slug && /^\d+$/.test(decodeURIComponent(handle)) ? (
                <p className="mb-4 text-xs text-muted-foreground">
                    Permalink:{" "}
                    <Link href={canonicalPath} className="text-primary underline">
                        {canonicalPath}
                    </Link>
                </p>
            ) : null}

            <div className="grid gap-10 lg:grid-cols-2 lg:gap-12 items-start">
                <ProductGallery urls={product.galleryUrls} alt={product.name} />
                <ProductPurchasePanel product={product} />
            </div>

            <ProductDetailTabs product={product} />

            {related.length > 0 ? (
                <section className="mt-20 border-t border-border/80 pt-12">
                    <h2 className="text-2xl font-bold tracking-tight">You may also like</h2>
                    <p className="text-sm text-muted-foreground mt-1">More in {product.category}</p>
                    <ul className="mt-8 grid auto-rows-fr gap-6 sm:grid-cols-2 xl:grid-cols-4">
                        {related.map((r) => (
                            <li key={r.id} className="flex min-h-0 h-full flex-col">
                                <ProductCard product={shopProductToPublic(r)} className="min-h-0 flex-1" />
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </main>
    );
}
