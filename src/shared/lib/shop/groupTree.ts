/**
 * Pure group-tree shapes and helpers — NO prisma, NO server-only imports.
 *
 * This exists as its own module because `productPublic.ts` is reached from
 * client components (ProductCard → ShopCatalogClient), so anything it imports
 * at RUNTIME lands in the browser bundle. `groupCategory.ts` imports prisma, so
 * importing a value from it — even a one-line pure helper — pulls prisma → pg →
 * `dns` into the client and the page dies with "Module not found: Can't resolve
 * 'dns'". Types alone are safe (erased at compile time); functions are not.
 *
 * So: pure shape + pure helpers here, the prisma-backed loader in
 * `groupCategory.ts`, which re-exports these for server callers.
 */

export type ShopGroup = {
    id: number;
    /** The group's own name — this is the customer-facing category. */
    name: string;
    /** Root-level page slug (`/laptops`); null when the group has no page yet. */
    slug: string | null;
    /** Ancestors nearest-first: [parent, grandparent, …, root]. Empty for a root. */
    ancestors: { id: number; name: string; slug: string | null }[];
};

/** groupId → the group and its ancestor chain. */
export type ShopGroupIndex = Map<number, ShopGroup>;

/** A group and every group under it — what a category page lists. */
export function groupSubtreeIds(index: ShopGroupIndex, id: number): number[] {
    return [...index.values()].filter((g) => g.id === id || g.ancestors.some((a) => a.id === id)).map((g) => g.id);
}

/** Where a category name links: its own page when it has a slug, else the /shop filter. */
export function groupHref(g: { name: string; slug: string | null }): string {
    return g.slug ? `/${g.slug}` : `/shop?category=${encodeURIComponent(g.name)}`;
}

/** The department a group belongs to — the last ancestor, or the group itself. */
export function rootOf(g: ShopGroup): { id: number; name: string } {
    return g.ancestors.length > 0 ? g.ancestors[g.ancestors.length - 1]! : { id: g.id, name: g.name };
}
