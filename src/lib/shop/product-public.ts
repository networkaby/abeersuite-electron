import type { ShopProduct } from "@/generated/prisma/client";

/** Serializable storefront shape (SSR → client, APIs). */
export type ShopProductPublic = {
    id: number;
    slug: string | null;
    name: string;
    subheading: string | null;
    description: string | null;
    category: string;
    pricePaise: number;
    mrpPaise: number | null;
    badge: string | null;
    imageUrl: string | null;
    galleryUrls: string[];
    specs: Record<string, string>;
};

export function productPath(p: Pick<ShopProductPublic, "id" | "slug">): string {
    return `/shop/product/${p.slug ?? p.id}`;
}

export function shopProductToPublic(p: ShopProduct): ShopProductPublic {
    const rawGal = p.galleryJson;
    let galleryUrls: string[] = [];
    if (Array.isArray(rawGal)) {
        galleryUrls = rawGal.filter((x): x is string => typeof x === "string");
    }
    if (galleryUrls.length === 0 && p.imageUrl) galleryUrls = [p.imageUrl];

    const rawSpecs = p.specsJson;
    const specs: Record<string, string> = {};
    if (rawSpecs && typeof rawSpecs === "object" && !Array.isArray(rawSpecs)) {
        for (const [k, v] of Object.entries(rawSpecs)) {
            if (typeof v === "string") specs[k] = v;
        }
    }

    return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        subheading: p.subheading,
        description: p.description,
        category: p.category,
        pricePaise: p.pricePaise,
        mrpPaise: p.mrpPaise,
        badge: p.badge,
        imageUrl: p.imageUrl,
        galleryUrls,
        specs,
    };
}

/** Deterministic demo star rating (4.2–4.9) and review count for UI polish. */
export function demoRating(productId: number): { stars: number; reviewCount: number } {
    const reviewCount = 18 + (productId % 210);
    const stars = 4.2 + (productId % 8) / 10;
    return { stars: Math.round(stars * 10) / 10, reviewCount };
}
