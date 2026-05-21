# Sales

> Sale-side activity across **store** (walk-in retail), **online** (ecommerce / shop), and **wholesale** (planned). Each channel writes the same data: `ShopOrder` for online, `Invoice` for direct (in-store + wholesale), with stock movement reflected via `InvVoucher` (type=SALES) into `InvStockLedger`.

## URLs

### UI pages — staff side (`src/app/(protected)/office/ecommerce/`)
- `/office/ecommerce/orders` — online orders dashboard.
- `/office/ecommerce/orders/[id]` — order detail (links to `Invoice` + `ShopOrder`).
- `/office/ecommerce/products` — shop catalogue (subset of `InvProduct` where `isListedInShop = true`).
- `/office/ecommerce/categories` — shop category management.
- `/office/ecommerce/coupons` — discount codes.
- `/office/ecommerce/dashboard` — sales dashboard (revenue, top SKUs).

### UI pages — customer side (`src/app/(external)/`)
- `/`, `/shop`, `/shop/product/[handle]`, `/shop/cart`, `/shop/checkout`, `/shop/order/[id]`, `/shop/wishlist`, `/shop/compare`. See [customer-portal.md](./customer-portal.md) for full list.

### API routes
- **Customer-facing** (`src/app/api/shop/`):
  - `/api/shop/products`, `/api/shop/products/[handle]` — public catalogue.
  - `/api/shop/orders`, `/api/shop/orders/[id]/razorpay` — order creation + Razorpay init.
  - `/api/shop/razorpay/webhook` — HMAC-verified payment confirmation.
- **Staff** (`src/app/api/ecommerce/`):
  - `/api/ecommerce/orders`, `/api/ecommerce/orders/[id]`, `/api/ecommerce/orders/[id]/status`, `/api/ecommerce/orders/[id]/return-ticket` — order management.
  - `/api/ecommerce/products`, `/api/ecommerce/products/[id]` — catalogue admin (uses unified `InvProduct`).
  - `/api/ecommerce/categories` — shop categories.
  - `/api/ecommerce/coupons`, `/api/ecommerce/coupons/[id]` — promotion codes.

## Permissions (gate keys)

- `ecommerce:manage` — manages catalog + orders.
- (Walk-in / wholesale don't yet have dedicated keys; Accountancy gates the invoice side.)

## Prisma models

- `ShopOrder` + `ShopOrderLine` (in `prisma/schema/shop.prisma`) — online orders. `ShopOrder.orderSource` distinguishes `online` / `phone` / `whatsapp` / `walkin`. Prices stored as integer paise. `ShopOrder.invoiceId` links to a posted `Invoice` once confirmed.
- `ShopCoupon` (in `prisma/schema/shop.prisma`) — discount codes (percent / fixed).
- `Invoice` (in `prisma/schema/finance.prisma`) — covers in-store + wholesale + `ShopOrder` confirmations. `Invoice.shopOrderId` is the back-link.
- `InvProduct` (in `prisma/schema/inventory.prisma`) — the single product source of truth for catalogue + warehouse + POS. The separate `ShopProduct` model was merged into `InvProduct` on 2026-05-04.

`ShopOrderLine.productId` references `InvProduct` directly.

## Key components / library

- `src/modules/external/shop/` — customer-facing storefront components (`ProductDetailTabs`, etc.).
- `src/modules/sales/components/` — staff-side order management UI.
- `prisma/seeds/data/demoCatalogSeed.ts` — seed data for demo products.
- `src/store/external/shopCartStore.ts`, `src/store/external/shopWishlistStore.ts`, `src/store/external/shopCompareStore.ts` — Zustand client stores for cart / wishlist / compare with localStorage persistence.

## Common workflows (wiring)

1. **Online order checkout** — `/shop/checkout` (customer) → POST `/api/shop/orders` → Razorpay init via `/api/shop/orders/[id]/razorpay` → customer pays → HMAC-verified webhook at `/api/shop/razorpay/webhook` confirms the order → emits a sale `InvVoucher` + `Invoice`. `Invoice.shopOrderId` links back.
2. **In-store walk-in sale** — POS register at `/vouchers/pos` (see [pos.md](./pos.md)) writes `Invoice` directly + a `SALE` `InvVoucher`. No `ShopOrder` row.
3. **Wholesale invoice** — staff creates an `Invoice` via Accountancy manually; `Invoice.accountId` points at the wholesale customer's GL ledger. No `ShopOrder`.
4. **Return** — staff opens a return ticket against an order at `/office/ecommerce/orders/[id]/return-ticket` → upon approval, posts a credit note via Accountancy + reverses stock via `SALE_RETURN` `InvVoucher` (see [pos.md](./pos.md) for the same flow at the counter).

## Recent decisions / gotchas

- **No separate ShopProduct** — `InvProduct.isListedInShop` flag controls visibility; same SKU flows through every channel. See [inventory.md](./inventory.md).
- **Wholesale channel is planned but partial** — no dedicated UI yet. Use Accountancy invoices manually with the wholesale party's `Account`.
- **Razorpay** is the only payment gateway today.

## Out of scope / deferred

- Wholesale-specific UI (price tier display, bulk-quote workflow).
- Subscription / recurring billing.
- Loyalty program integration beyond coupons.
- Walk-in POS terminal UI.

## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|---|---|---|
| `getOrdersPipeline(prisma)`, `assertOrdersStatus(prisma, pipelineId, status)`, `ORDERS_PIPELINE_NAME` | `src/modules/ecommerce/lib/ordersPipeline.ts` | Name-based resolver for the seeded sales-orders pipeline + status validator. |
| `ORDER_STATUS_TRANSITIONS`, `canTransition(from, to)` | `src/modules/ecommerce/lib/orderStatusTransitions.ts` | Allowed `ShopOrderStatus` transition graph. |
| `transitionShopOrderStatus`, `transitionOrderPipelineStatus` | `src/modules/ecommerce/lib/orderStatus.ts` | Write-side helpers that move a shop order between statuses (both the enum on the row and the pipeline state). Used by the webhook + manual status changes. |
| `invProductToAdmin(invProduct)`, `ShopProductAdmin` (type) | `src/modules/ecommerce/lib/productAdmin.ts` | Reshape an `InvProduct` row into the admin-side shape used by the ecommerce products UI. |

_Last updated: 2026-05-21 — `postSaleJournal` inside `transitionShopOrderStatus` now mints its JE reference through the `GL_POSTING` VoucherSeries (`GL-…` prefix) instead of the legacy `JE-…` series; the JE itself is otherwise identical (Dr Bank / Cr Revenue). See [accountancy.md → Two engines](./accountancy.md) for the rationale. Previously (2026-05-19): API routes corrected (`/api/shop/*` customer-facing, `/api/ecommerce/*` staff-side); model files corrected (`ShopOrder`/`ShopOrderLine`/`ShopCoupon` live in `shop.prisma`, no `sales.prisma` exists); `ShopCoupon` name corrected (was `Coupon`); `ReturnTicket` model never existed — return flow is via `SALE_RETURN` `InvVoucher` + credit note; `ShopProduct → InvProduct` merge dated to 2026-05-04._
