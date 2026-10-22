import StorefrontChrome from "@/modules/external/shop/StorefrontChrome";

/**
 * Shared chrome for the whole shopping surface. The `(shop)` group adds NO URL
 * segment, so the routes inside keep their own paths — `/shop`, `/shop/cart`
 * and the root-level slug pages (`/hp-15-laptop`, `/laptops`, `/hp`) — while
 * rendering inside one header/footer.
 *
 * A product / category / collection / brand page belongs to this group rather
 * than carrying a layout of its own. Titles stay with each route:
 * `shop/layout.tsx` names the catalog section, `[slug]/page.tsx` names the
 * product or listing.
 */
export default function ShopGroupLayout({ children }: { children: React.ReactNode }) {
    return <StorefrontChrome>{children}</StorefrontChrome>;
}
