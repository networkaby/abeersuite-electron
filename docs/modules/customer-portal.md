# Customer Portal

> The external (`/`-rooted) customer-facing surface. Two modes — anonymous storefront browsing + signed-in customer self-service. Separate auth from staff (phone or email + bcrypt; NextAuth `kind: "customer"`).

## URLs

### Public storefront (anonymous)
- `/` — homepage (Network Shop)
- `/shop`, `/shop/[slug]`, `/shop/category/[slug]`
- `/cart`, `/wishlist`, `/compare`
- `/shop/checkout` — Razorpay flow
- `/shop/order/[orderId]` — public order tracking

### Customer self-service (`/(external)/customer/`)
- `/customer/login`, `/customer/register`, `/customer/reset-password`
- `/customer/dashboard` — overview
- `/customer/tickets` — repair tickets
- `/customer/orders` — past orders
- `/customer/repairs` — repair history (subset of tickets)
- `/customer/wallet` — account balance
- `/customer/wishlist`
- `/customer/social` — privacy-circled feed (see [messaging.md](./messaging.md))
- `/customer/settings` — profile / password / address

### API routes (`src/app/api/customer/...` and `/api/shop/...`)
- `/api/auth/callback/credentials-customer` — NextAuth provider for customers.
- `/api/customer/me` — session-aware profile read/edit.
- `/api/shop/products`, `/api/shop/cart`, `/api/shop/orders` — storefront read + cart sync.

## Permissions

Customer auth uses `kind: "customer"` on the NextAuth session. **Staff `requireAuth` rejects sessions with `kind: "customer"`** (returns 403). All staff-side endpoints are gated this way at the very top of `requireAuth`.

Customers don't have permission keys — gates are hard-coded by the `kind` discriminator.

## Prisma models

- `Customer` (in `prisma/schema/customers.prisma`) — same row as the staff-side customer record; portal credentials are `Customer.email` / `Customer.phone` + `Customer.password` (bcrypt).
- `ShopOrder` + `ShopOrderLine` — see [sales.md](./sales.md).
- `Ticket` — same as staff side; customer sees only their own.

## Key components / library

- `src/modules/external/shop/` — storefront UI (`ProductDetailTabs`, `Hero`, `CategoryGrid`).
- `src/modules/external/customer/` — portal UI (`Dashboard`, `OrderList`, `TicketList`).
- `src/store/shopCartStore.ts`, `wishlistStore.ts`, `compareStore.ts` — Zustand persistence in localStorage; merged into server cart on sign-in.
- `src/lib/auth-customer.ts` — customer-only auth helpers.
- `src/auth.ts` — NextAuth config with two providers: `credentials-staff`, `credentials-customer`.

## Common workflows (wiring)

1. **Anonymous → checkout** — local cart in Zustand → at checkout, prompt sign-in or guest → POST `/api/shop/orders` → Razorpay → on success, `ShopOrder` confirmed + `Invoice` created (see [accountancy.md](./accountancy.md)).
2. **Customer signs in** — `/customer/login` → NextAuth credentials-customer provider → session has `kind: "customer"` → middleware allows `/customer/*` but not `/office/*`.
3. **Customer views ticket** — `/customer/tickets/[id]` → reads `/api/customer/tickets/[id]` which filters by `Ticket.customerId === session.userId`.

## Recent decisions / gotchas

- **Two NextAuth providers, one session shape** — staff vs customer is by `kind` field, not separate auth domains. `requireAuth()` in `src/lib/auth-guard.ts` rejects customer sessions to keep staff endpoints safe.
- **Cart in localStorage** — survives reload. On sign-in, the merge logic POSTs the cart to the server.
- **Razorpay client config** — public key in env, secret server-side only.

## Out of scope / deferred

- Native mobile app — web responsive only.
- Loyalty / referral program.
- Live chat with staff from the portal.

_Last updated: 2026-05-07._
