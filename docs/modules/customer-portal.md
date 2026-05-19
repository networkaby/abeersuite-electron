# Customer Portal

> The external (`/`-rooted) customer-facing surface. Two modes — anonymous storefront browsing + signed-in customer self-service. Separate auth from staff (phone or email + bcrypt; NextAuth `credentials-portal` provider; session `kind: "customer"`). Backed by a separate `PersonPortalCredential` row, never the staff session.

## URLs

### Public storefront (anonymous) — `src/app/(external)/`
- `/` — store homepage (`(external)/(store)/page.tsx`) — hero, deals, featured products, brand strip.
- `/shop` — catalogue listing.
- `/shop/product/[handle]` — product detail.
- `/shop/cart`, `/shop/wishlist`, `/shop/compare` — local Zustand state (no DB until checkout).
- `/shop/checkout` — Razorpay flow.
- `/shop/order/[id]` — public order confirmation / tracking.

### Customer auth & self-service — `src/app/(external)/`
- `/login` — customer sign-in page (`(external)/login/page.tsx`). NextAuth `credentials-portal` provider. `/portal/login` 307-redirects here for legacy bookmarks (handled in `src/proxy.ts`).
- `/portal/register` — self-registration form.
- `/portal` — customer hub (signed-in landing).
- `/portal/tickets` — own repair tickets list.
- `/portal/orders` — past shop orders.
- `/portal/repairs` — repair-pipeline tickets subset.
- `/portal/wallet` — account balance / advances.
- `/portal/wishlist` — server-synced wishlist.
- `/portal/coupons` — issued coupons.
- `/portal/social` — privacy-circled feed (see [messaging.md](./messaging.md)).
- `/portal/settings` — profile / password / address.

### API routes — `src/app/api/`
- `/api/auth/callback/credentials-portal` — NextAuth provider for customers.
- `/api/portal/register` — POST, self-registration.
- `/api/portal/account-context` — GET, session-aware profile / linked records.
- `/api/portal/password` — POST, change password.
- `/api/portal/tickets` — GET, customer's own tickets.
- `/api/shop/products`, `/api/shop/products/[handle]` — public product catalogue.
- `/api/shop/orders`, `/api/shop/orders/[id]/razorpay` — order creation + payment init.
- `/api/shop/razorpay/webhook` — HMAC-verified payment confirmation.

## Permissions

Customer auth uses `kind: "customer"` on the NextAuth session. **Staff `requirePermission` and `requireAuth` reject sessions where `kind !== "staff"`** (returns 403). Customers don't have permission keys — gates are hard-coded by the `kind` discriminator and by `requirePortalAuth` from `src/shared/lib/auth/portalAuthGuard.ts`.

## Prisma models

- `Person`, `Company` (`prisma/schema/base.prisma`) — same rows as the staff-side customer records.
- `PersonPortalCredential` (`prisma/schema/portal.prisma`) — separate credential row linked to a `Person`. Stores phone-or-email identifier + bcrypt password hash. Never connected to the NextAuth staff session.
- `ShopOrder` + `ShopOrderLine` — see [sales.md](./sales.md).
- `Ticket` — same as staff side; customer queries are filtered by `Ticket.customerId === session.userId`.

## Key components / library

- `src/modules/external/shop/` — storefront UI (`ProductCard`, `ProductDetailTabs`, `ProductGallery`, `ProductPurchasePanel`, `ShopHeader`, `ShopFooter`, `ShopCatalogClient`, `ShopPageBanner`, `ShopRemoteImage`, `ShopSearchBar`, `AddToCartButton`).
- `src/modules/external/store/` — store homepage strips (`HeroCarousel`, `DealOfTheDay`, `FeaturedRow`, `BrandStrip`, `TrustStrip`, `CategoryShowcase`, `PromoBanners`).
- `src/modules/external/portal/` — portal UI (`PortalHeader`).
- `src/modules/external/ExternalRootShell.tsx` — root layout shell wrapping NextAuth `SessionProvider` + `Toaster`.
- `src/store/external/shopCartStore.ts`, `shopWishlistStore.ts`, `shopCompareStore.ts` — Zustand + localStorage. Merged into server state on sign-in.
- `src/shared/lib/auth/authorizePortal.ts` — credential validation.
- `src/shared/lib/auth/portalAuthGuard.ts` — `requirePortalAuth` for route guards.
- `src/shared/lib/auth/portalIdentifier.ts` — phone/email normalisation.
- `src/auth.ts` — NextAuth config with two providers: `credentials-staff`, `credentials-portal`.

## Common workflows (wiring)

1. **Anonymous → checkout** — local cart in Zustand → at `/shop/checkout`, prompt sign-in or proceed as guest → POST `/api/shop/orders` → Razorpay → on success webhook → `ShopOrder` confirmed + `Invoice` created (see [accountancy.md](./accountancy.md)).
2. **Customer signs in** — `/login` → NextAuth `credentials-portal` → session `kind: "customer"` → `src/proxy.ts` allows `/portal/*` but blocks `/office/*`.
3. **Customer views ticket** — `/portal/tickets` → `GET /api/portal/tickets` filtered by the session's linked `Person.id`.

## Recent decisions / gotchas

- **Two NextAuth providers, one session shape.** Staff vs customer is by `kind` field, not separate auth domains. `requireAuth()` / `requirePermission()` reject `kind !== "staff"`; `requirePortalAuth()` requires `kind === "customer"`. Boundary checks are at the very top of each guard.
- **Cart in localStorage.** Survives reload. On sign-in, the merge logic POSTs the cart to the server.
- **Razorpay confirmation is webhook-driven.** The client-side payment response is for UX only; `ShopOrder` confirmation waits for the HMAC-verified webhook at `/api/shop/razorpay/webhook`.
- **`/portal/login` is a redirect, not a page.** All customer sign-in goes through `/login`.

## Cross-boundary imports (external → staff-side code)

The customer surface (`src/app/(external)/**`, `src/modules/external/**`) imports from staff-side trees in five load-bearing categories. If the surface is ever extracted into a separate app, these are the import categories to break:

1. **shadcn UI primitives** — `@/components/ui/*` (button, card, badge, dropdown-menu, tabs, breadcrumb, etc.). Strategy: keep — UI primitives are framework-agnostic.
2. **Money formatting** — `@/shared/lib/format/moneyInr` (₹ paise→display). Strategy: extract `packages/money`.
3. **Product helpers** — `@/shared/lib/shop/productPublic`, `storeContent`, `demoReviews`, `shopImagePlaceholder`. Strategy: extract `packages/shop-lib`.
4. **Brand / company constants** — `@/utils/constants-company-details`. Strategy: extract `packages/constants` or env var.
5. **Zustand stores** — `@/store/external/shopCartStore` / `shopWishlistStore` / `shopCompareStore`. Already external — keep as-is.

Server-side imports (`@/lib/prisma`, `@/auth`) only appear in SSR pages and are the natural break point for a separate-app split.

## Out of scope / deferred

- Native mobile app — web responsive only.
- Loyalty / referral program.
- Live chat with staff from the portal.
- Portal ticket detail page (`/portal/tickets/[id]`) — currently the list only.
- Real-time Razorpay payment status polling page.

_Last updated: 2026-05-19 — routes corrected (`/customer/*` → `/portal/*` + `/login`); APIs corrected (`/api/customer/*` → `/api/portal/*`); model file corrected (`PersonPortalCredential` in `portal.prisma`, not `Customer` in `customers.prisma`); NextAuth provider name corrected (`credentials-portal`)._
