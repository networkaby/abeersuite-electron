import { SHOP_NATIVE_HOME } from "@/shared/lib/device/shopApp";
import type { ShopProductPublic } from "@/shared/lib/shop/productPublic";

/** Every address inside the customer app — the app never links out to the website. */
export const APP = SHOP_NATIVE_HOME;

export function appProductPath(p: Pick<ShopProductPublic, "id" | "slug">): string {
    return `${APP}/product/${p.slug ?? p.id}`;
}

export function appProductsPath(params: { q?: string; category?: string } = {}): string {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.category) sp.set("category", params.category);
    const qs = sp.toString();
    return `${APP}/products${qs ? `?${qs}` : ""}`;
}

/**
 * A link written for the website (a Customize-Home banner's button, say) turned
 * into the app's own screen: a product page, a filtered list, or Home.
 */
export function toAppHref(href: string): string {
    const url = new URL(href, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return APP;
    const product = url.pathname.match(/^\/shop\/product\/([^/]+)/);
    if (product) return `${APP}/product/${product[1]}`;
    if (url.pathname === "/shop" || url.pathname === "/") {
        return appProductsPath({ q: url.searchParams.get("q") ?? undefined, category: url.searchParams.get("category") ?? undefined });
    }
    return APP;
}
