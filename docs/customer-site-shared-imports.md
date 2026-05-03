# Customer site / external surface — shared imports registry

**URL reminder:** Customer/shop pages live at **`/`**, **`/shop/*`**, **`/portal/*`**. Staff pages live under **`/office/*`** (`src/app/(protected)/office/`) and are out of scope for this registry unless they import from `(external)`.

When `src/app/(external)/**` or `src/modules/external/**` imports **pre-existing** code outside those trees, add a row here so splitting into a separate customer app is traceable.

| External file | Existing import path | Type | Reason | Split strategy |
|---------------|----------------------|------|--------|----------------|
| `src/app/(external)/layout.tsx` | `@/modules/external/ExternalRootShell` | component | NextAuth `SessionProvider` for portal/shop | duplicate thin shell or shared `packages/ui-session` |
| `src/modules/external/ExternalRootShell.tsx` | `next-auth/react` `SessionProvider` | npm | Client session | keep |
| `src/modules/external/ExternalRootShell.tsx` | `@/components/ui/sonner` (Toaster) | shadcn | Toast notifications | keep |
| `src/app/(external)/portal/layout.tsx` | `@/modules/external/portal/PortalHeader` | component | Portal nav | keep |
| `src/app/(external)/(store)/layout.tsx` | `@/modules/external/shop/ShopHeader` `ShopFooter` | component | Store homepage header/footer | keep |
| `src/app/(external)/shop/layout.tsx` | `@/modules/external/shop/ShopHeader` `ShopFooter` | component | Shop header/footer | keep |
| `src/modules/external/portal/PortalHeader.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/modules/external/shop/ShopHeader.tsx` | `@/components/ui/badge` `button` `dropdown-menu` | shadcn | Cart count badge + nav | keep |
| `src/modules/external/shop/ShopHeader.tsx` | `@/utils/constants-company-details` | utils | Brand name / logo | extract `packages/constants` or env var |
| `src/modules/external/shop/ShopHeader.tsx` | `@/store/external/shopCartStore` `shopWishlistStore` `shopCompareStore` | zustand | Cart/wishlist/compare counts | keep (already external) |
| `src/modules/external/shop/ShopFooter.tsx` | `@/utils/constants-company-details` | utils | Brand/contact info | extract `packages/constants` |
| `src/modules/external/shop/AddToCartButton.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/modules/external/shop/AddToCartButton.tsx` | `@/store/external/shopCartStore` | zustand | Cart state | keep (already external) |
| `src/modules/external/shop/ProductCard.tsx` | `@/components/ui/button` `badge` `card` | shadcn | UI | keep |
| `src/modules/external/shop/ProductCard.tsx` | `@/lib/shop/product-public` | lib | Product type + helpers | extract `packages/shop-lib` |
| `src/modules/external/shop/ProductCard.tsx` | `@/lib/money-inr` | lib | ₹ price formatting | extract `packages/money` |
| `src/modules/external/shop/ProductCard.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/shop/ProductCard.tsx` | `@/store/external/shopCartStore` `shopWishlistStore` `shopCompareStore` | zustand | Cart/wishlist/compare actions | keep (already external) |
| `src/modules/external/shop/ProductDetailTabs.tsx` | `@/components/ui/tabs` `badge` | shadcn | Tabs UI | keep |
| `src/modules/external/shop/ProductDetailTabs.tsx` | `@/lib/shop/product-public` `demo-reviews` | lib | Product type + static reviews | extract `packages/shop-lib` |
| `src/modules/external/shop/ProductDetailTabs.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/shop/ProductGallery.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/shop/ProductPurchasePanel.tsx` | `@/components/ui/button` `input` `badge` | shadcn | UI | keep |
| `src/modules/external/shop/ProductPurchasePanel.tsx` | `@/lib/shop/product-public` | lib | Product type + rating | extract `packages/shop-lib` |
| `src/modules/external/shop/ProductPurchasePanel.tsx` | `@/lib/money-inr` | lib | ₹ price formatting | extract `packages/money` |
| `src/modules/external/shop/ProductPurchasePanel.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/shop/ProductPurchasePanel.tsx` | `@/store/external/shopCartStore` `shopWishlistStore` `shopCompareStore` | zustand | Cart/wishlist/compare actions | keep (already external) |
| `src/modules/external/shop/ShopPageBanner.tsx` | `@/components/ui/button` `breadcrumb` | shadcn | UI | keep |
| `src/modules/external/shop/ShopPageBanner.tsx` | `@/utils/constants-company-details` | utils | Brand name | extract `packages/constants` |
| `src/modules/external/shop/ShopPageBanner.tsx` | `@/lib/shop/store-content` | lib | Hero slides data | extract `packages/shop-lib` |
| `src/modules/external/shop/ShopCatalogClient.tsx` | `@/components/ui/input` `button` `label` `select` `checkbox` | shadcn | Filter UI | keep |
| `src/modules/external/shop/ShopCatalogClient.tsx` | `@/lib/shop/product-public` | lib | Product type | extract `packages/shop-lib` |
| `src/modules/external/shop/ShopCatalogClient.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/shop/ShopRemoteImage.tsx` | `@/lib/shop/shop-image-placeholder` | lib | Fallback image path | extract `packages/shop-lib` |
| `src/modules/external/store/HeroCarousel.tsx` | `@/components/ui/button` | shadcn | Nav buttons | keep |
| `src/modules/external/store/HeroCarousel.tsx` | `@/lib/shop/store-content` | lib | Hero slides config | extract `packages/shop-lib` |
| `src/modules/external/store/HeroCarousel.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/modules/external/store/DealOfTheDay.tsx` | `@/components/ui/button` `badge` | shadcn | UI | keep |
| `src/modules/external/store/DealOfTheDay.tsx` | `@/lib/shop/product-public` | lib | Product type + helpers | extract `packages/shop-lib` |
| `src/modules/external/store/DealOfTheDay.tsx` | `@/lib/money-inr` | lib | ₹ price formatting | extract `packages/money` |
| `src/modules/external/store/FeaturedRow.tsx` | `@/lib/shop/product-public` | lib | Product type | extract `packages/shop-lib` |
| `src/modules/external/store/CategoryShowcase.tsx` | `@/lib/shop/store-content` | lib | Category images config | extract `packages/shop-lib` |
| `src/modules/external/store/BrandStrip.tsx` | `@/lib/shop/store-content` | lib | Brand logos config | extract `packages/shop-lib` |
| `src/modules/external/store/TrustStrip.tsx` | `@/utils/constants-company-details` | utils | Company trust data | extract `packages/constants` |
| `src/modules/external/store/TrustStrip.tsx` | `@/lib/money-inr` | lib | ₹ free-shipping threshold | extract `packages/money` |
| `src/modules/external/store/PromoBanners.tsx` | `@/lib/shop/store-content` | lib | Banner config | extract `packages/shop-lib` |
| `src/modules/external/store/PromoBanners.tsx` | `@/lib/utils` (cn) | lib | className merge | keep |
| `src/app/(external)/(store)/page.tsx` | `@/lib/prisma` | server | SSR product catalog for homepage | extract `packages/db` |
| `src/app/(external)/(store)/page.tsx` | `@/lib/shop/product-public` `store-content` | lib | Product queries + homepage config | extract `packages/shop-lib` |
| `src/app/(external)/shop/page.tsx` | `@/lib/prisma` | server | SSR catalog fetch | extract `packages/db` |
| `src/app/(external)/shop/page.tsx` | `@/lib/shop/product-public` | lib | Product serialisation | extract `packages/shop-lib` |
| `src/app/(external)/shop/product/[handle]/page.tsx` | `@/lib/prisma` | server | SSR product detail | extract `packages/db` |
| `src/app/(external)/shop/product/[handle]/page.tsx` | `@/lib/shop/product-public` | lib | Product query + serialisation | extract `packages/shop-lib` |
| `src/app/(external)/shop/cart/page.tsx` | `@/components/ui/button` `card` `input` | shadcn | Cart UI | keep |
| `src/app/(external)/shop/cart/page.tsx` | `@/lib/money-inr` | lib | ₹ formatting | extract `packages/money` |
| `src/app/(external)/shop/cart/page.tsx` | `@/lib/shop/product-public` | lib | Product type | extract `packages/shop-lib` |
| `src/app/(external)/shop/cart/page.tsx` | `@/store/external/shopCartStore` | zustand | Cart state | keep (already external) |
| `src/app/(external)/shop/wishlist/page.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/app/(external)/shop/wishlist/page.tsx` | `@/lib/shop/product-public` | lib | Product type | extract `packages/shop-lib` |
| `src/app/(external)/shop/wishlist/page.tsx` | `@/store/external/shopWishlistStore` | zustand | Wishlist state | keep (already external) |
| `src/app/(external)/shop/compare/page.tsx` | `@/components/ui/button` `table` | shadcn | Compare table UI | keep |
| `src/app/(external)/shop/compare/page.tsx` | `@/lib/shop/product-public` | lib | Product type + path | extract `packages/shop-lib` |
| `src/app/(external)/shop/compare/page.tsx` | `@/lib/money-inr` | lib | ₹ formatting | extract `packages/money` |
| `src/app/(external)/shop/compare/page.tsx` | `@/store/external/shopCompareStore` | zustand | Compare state | keep (already external) |
| `src/app/(external)/shop/checkout/page.tsx` | `@/components/ui/button` `input` `label` `card` `badge` | shadcn | Checkout form UI | keep |
| `src/app/(external)/shop/checkout/page.tsx` | `@/lib/money-inr` | lib | ₹ order total | extract `packages/money` |
| `src/app/(external)/shop/checkout/page.tsx` | `@/lib/shop/product-public` | lib | Product type + path | extract `packages/shop-lib` |
| `src/app/(external)/shop/checkout/page.tsx` | `@/store/external/shopCartStore` | zustand | Cart state | keep (already external) |
| `src/app/(external)/shop/order/[id]/page.tsx` | `@/lib/prisma` | server | SSR order confirmation | extract `packages/db` |
| `src/app/(external)/shop/order/[id]/page.tsx` | `@/lib/money-inr` | lib | ₹ total | extract `packages/money` |
| `src/app/(external)/shop/order/[id]/page.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/app/(external)/portal/page.tsx` | `@/auth` | server | SSR session check | extract auth types |
| `src/app/(external)/portal/page.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/app/(external)/login/page.tsx` | `@/components/ui/*` | shadcn | Customer portal credentials form | keep |
| `src/app/(external)/portal/register/page.tsx` | `@/components/ui/*` | shadcn | Forms | keep |
| `src/app/(external)/portal/tickets/page.tsx` | `@/auth` | server | SSR session + customer lookup | extract auth types |
| `src/app/(external)/portal/tickets/page.tsx` | `@/lib/prisma` | server | SSR ticket fetch | extract `packages/db` |
| `src/app/(external)/portal/tickets/page.tsx` | `@/components/ui/badge` | shadcn | Status badge | keep |
| `src/store/external/shopCartStore.ts` | `zustand` | npm | Cart state | keep |
| `src/store/external/shopWishlistStore.ts` | `zustand` | npm | Wishlist state | keep |
| `src/store/external/shopCompareStore.ts` | `zustand` | npm | Compare state | keep |

_Add new rows for any future imports from `@/modules/shared/*`, `@/lib/*` (beyond the above), or staff-only APIs._
