# Sales

> Sale-side activity across **store** (walk-in retail), **online** (ecommerce / shop), and **wholesale** (planned). Every sale — in-store POS, online order confirmation, wholesale, returns — writes a single `InvVoucher` row (type `SALE` / `POS` / `SALE_RETURN`) that owns its stock movement, GL JE, and settlement tenders. The legacy `Invoice` / `Payment` tables were dropped in the consolidation (Layers 2–5, 2026-05-23/24). Online orders additionally have `ShopOrder` + `ShopOrderLine` for the customer-facing checkout shape; the row links forward to the sale via `ShopOrder.invoiceId` (now pointing at the `InvVoucher` id, kept under the legacy field name).

## URLs

### UI pages — staff side (`src/app/(protected)/office/ecommerce/`)
- `/office/ecommerce/orders` — online orders dashboard.
- `/office/ecommerce/orders/[id]` — order detail (links to the order's sale `InvVoucher` + `ShopOrder`).
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

- `ShopOrder` + `ShopOrderLine` (in `prisma/schema/shop.prisma`) — online orders. `ShopOrder.orderSource` distinguishes `online` / `phone` / `whatsapp` / `walkin`. Prices stored as integer paise. `ShopOrder.invoiceId` links to a DRAFT `InvVoucher` (type=SALE) auto-created at order-confirm time (Layer 2e, 2026-05-24). The field name is kept for back-compat; the FK target is `InvVoucher.id`.
- `ShopCoupon` (in `prisma/schema/shop.prisma`) — discount codes (percent / fixed).
- `InvVoucher` (in `prisma/schema/inventory.prisma`) — covers in-store (POS), wholesale (SALE), and `ShopOrder` confirmations (SALE with `shopOrderId` set). See [inventory.md](./inventory.md) for the full schema, including `InvVoucherTender` (settlement legs) and `InvVoucherCharge` (additional ledger rows).
- `InvProduct` (in `prisma/schema/inventory.prisma`) — the single product source of truth for catalogue + warehouse + POS. The separate `ShopProduct` model was merged into `InvProduct` on 2026-05-04.

`ShopOrderLine.productId` references `InvProduct` directly.

## Key components / library

- `src/modules/external/shop/` — customer-facing storefront components (`ProductDetailTabs`, etc.).
- `src/modules/sales/components/` — staff-side order management UI.
- `prisma/seeds/data/demoCatalogSeed.ts` — seed data for demo products.
- `src/store/external/shopCartStore.ts`, `src/store/external/shopWishlistStore.ts`, `src/store/external/shopCompareStore.ts` — Zustand client stores for cart / wishlist / compare with localStorage persistence.

## Common workflows (wiring)

1. **Online order checkout** — `/shop/checkout` (customer) → POST `/api/shop/orders` → Razorpay init via `/api/shop/orders/[id]/razorpay` → customer pays → HMAC-verified webhook at `/api/shop/razorpay/webhook` confirms the order. On Confirm the pipeline transition calls `createOrderInvVoucher` (in `orderStatus.ts`) which writes a **DRAFT SALE `InvVoucher`** with `shopOrderId` set, customer `accountId`, `creditPeriodDays=30`, `deliveryMode=SHIPPED`. An operator posts the voucher via the inventory lifecycle; `postInvVoucherToGl` then creates the JE (Dr Customer AR / Cr Shop Sales Revenue / Cr GST Output).
2. **In-store walk-in sale** — POS register at `/vouchers/pos` (see [pos.md](./pos.md)) writes a single `InvVoucher` (type=POS) with its own tender rows. No `ShopOrder` row.
3. **Wholesale sale** — staff creates a SALE `InvVoucher` via the `/vouchers/sale` form (TradingVoucherPage); the customer's GL ledger is the AR tender row's `accountId`. No `ShopOrder`.
4. **Return** — staff opens a return ticket against an order at `/office/ecommerce/orders/[id]/return-ticket` → upon approval, a `SALE_RETURN` `InvVoucher` reverses stock and posts the credit-note JE in one shot (see [pos.md](./pos.md) for the same flow at the counter).

## Recent decisions / gotchas

- **No separate ShopProduct** — `InvProduct.isListedInShop` flag controls visibility; same SKU flows through every channel. See [inventory.md](./inventory.md).
- **Wholesale channel is planned but partial** — no dedicated UI yet. Use the SALE voucher form (`/vouchers/sale`) manually with the wholesale party's `Account` as the AR tender.
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

_Last updated: 2026-05-24 — **Layer 2e: ecommerce SALE on InvVoucher.** Order-confirm pipeline transition (`createOrderInvVoucher` in `orderStatus.ts`) now writes a DRAFT SALE `InvVoucher` with `shopOrderId` set, instead of the legacy DRAFT `Invoice`. `ShopOrder.invoiceId` now points at the new InvVoucher row (field name kept for back-compat). Posting still happens via the inventory voucher lifecycle. Previously (2026-05-23): online orders dashboard (`/office/ecommerce/orders`) date filter migrated to `TallyDateInput` (dd/mm/yyyy + Tally shorthand parsing); no behaviour change. Previously (2026-05-21): `postSaleJournal` inside `transitionShopOrderStatus` now mints its JE reference through the `GL_POSTING` VoucherSeries (`GL-…` prefix) instead of the legacy `JE-…` series; the JE itself is otherwise identical (Dr Bank / Cr Revenue). See [accountancy.md → Two engines](./accountancy.md) for the rationale._
