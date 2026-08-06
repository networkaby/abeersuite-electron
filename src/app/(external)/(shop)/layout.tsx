import StorefrontChrome from "@/modules/external/shop/StorefrontChrome";

/**
 * Shared chrome for the whole shopping surface. The `(shop)` group adds NO URL
 * segment, so the routes inside keep their own paths — `/shop`, `/shop/cart`,
 * `/shop/product/…` and the root-level brand slugs (`/hp`) — while rendering
 * inside one header/footer.
 *
 * A brand page is the shop filtered to one brand, so it belongs to this group
 * rather than carrying a layout of its own. Titles stay with each route:
 * `shop/layout.tsx` names the catalog section, `[slug]/page.tsx` names the
 * brand.
 */
export default function ShopGroupLayout({ children }: { children: React.ReactNode }) {
    return <StorefrontChrome>{children}</StorefrontChrome>;
}
