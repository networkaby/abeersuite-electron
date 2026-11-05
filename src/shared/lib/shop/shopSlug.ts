import { cache } from "react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { isReservedShopSlug } from "@/shared/lib/shop/storefrontSlugPath";
import { slugify } from "@/shared/lib/format/slugify";

/**
 * One flat URL space for the shop: `/hp-15-laptop` (product), `/laptops`
 * (category = office Group), `/kids-collection` (collection = office Category)
 * and `/hp` (brand) all live at the root, served by
 * `src/app/(external)/(shop)/[slug]/page.tsx`.
 *
 * Each table keeps its own `slug @unique`; what keeps the four apart is
 * `shopSlugClash`, run on every save that sets a slug.
 */

export type ShopSlugKind = "product" | "group" | "category" | "brand";

const KIND_LABEL: Record<ShopSlugKind, string> = {
    product: "a product",
    group: "a category (group)",
    category: "a collection (category)",
    brand: "a brand",
};

/**
 * Why `slug` cannot be saved on this row — taken by a page of the app, or by
 * another product / group / category / brand — or null when it is free.
 * `self` is the row being saved, so re-saving its own slug is not a clash.
 */
export async function shopSlugClash(slug: string, self: { kind: ShopSlugKind; id?: number }): Promise<string | null> {
    const s = slug.trim();
    if (!s) return null;
    if (isReservedShopSlug(s)) return `"${s}" is a page of the website and cannot be used as a link`;

    const not = (kind: ShopSlugKind) => (self.kind === kind && self.id != null ? { NOT: { id: self.id } } : {});
    const [product, group, category, brand] = await Promise.all([
        prisma.invProduct.findFirst({ where: { slug: s, ...not("product") }, select: { id: true } }),
        prisma.invProductGroup.findFirst({ where: { slug: s, ...not("group") }, select: { id: true } }),
        prisma.invCategory.findFirst({ where: { slug: s, ...not("category") }, select: { id: true } }),
        prisma.invBrand.findFirst({ where: { slug: s, ...not("brand") }, select: { id: true } }),
    ]);
    const taken = (Object.entries({ product, group, category, brand }) as [ShopSlugKind, unknown][]).find(([, row]) => row);
    return taken ? `Link "${s}" is already used by ${KIND_LABEL[taken[0]]}` : null;
}

/**
 * A free link made from `name` — "CCTV & Security" → "cctv-security",
 * then "-2", "-3"… when taken. Used when a group / collection is created
 * without a link, so every one gets its own `/name` shop page.
 */
export async function autoShopSlug(name: string, self: { kind: ShopSlugKind; id?: number }): Promise<string | null> {
    const base = slugify(name, { maxLength: 80 });
    if (!base) return null;
    for (let n = 1; n <= 50; n++) {
        const candidate = n === 1 ? base : `${base}-${n}`;
        if (!(await shopSlugClash(candidate, self))) return candidate;
    }
    return null;
}

/** The group / category / brand behind a root slug, active rows only. */
export type ShopSlugTarget =
    | { kind: "group"; id: number; name: string; slug: string; imageUrl: string | null; description: string | null }
    | { kind: "category"; id: number; name: string; slug: string; imageUrl: string | null; description: string | null }
    | { kind: "brand"; id: number; name: string; slug: string; imageUrl: string | null; description: string | null };

const pageSelect = { id: true, name: true, slug: true, imageUrl: true, description: true } as const;

/**
 * Resolve a non-product slug. Products are looked up first by the page itself
 * (through `loadShopProduct`, which also applies the shop's visibility gates).
 * `cache()` shares the answer between generateMetadata and the page body.
 */
export const resolveShopSlugTarget = cache(async (raw: string): Promise<ShopSlugTarget | null> => {
    const slug = decodeURIComponent(raw);
    const [group, category, brand] = await Promise.all([
        prisma.invProductGroup.findFirst({ where: { slug, isActive: true }, select: pageSelect }),
        prisma.invCategory.findFirst({ where: { slug, isActive: true }, select: pageSelect }),
        prisma.invBrand.findFirst({ where: { slug, isActive: true }, select: pageSelect }),
    ]);
    if (group) return { kind: "group", ...group, slug };
    if (category) return { kind: "category", ...category, slug };
    if (brand) return { kind: "brand", ...brand, slug };
    return null;
});
