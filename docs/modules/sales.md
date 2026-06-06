# Sales

> Sale-side activity across **store** (walk-in retail), **online** (ecommerce / shop), and **wholesale** (planned). In-store POS, wholesale, and returns each write a single `InvVoucher` row (type `SALE` / `POS` / `SALE_RETURN`) that owns its stock movement, GL JE, and settlement tenders. The legacy `Invoice` / `Payment` tables were dropped in the consolidation (Layers 2–5, 2026-05-23/24). **Online orders are Pay-on-Delivery (COD):** a customer order becomes a ticket on the `sales-orders` pipeline (P7); placing or advancing an order has **no accounting side-effects** — staff raise the invoice (a SALE `InvVoucher`) **manually** through the office voucher flow, which posts stock + GL on post. Online orders carry `ShopOrder` + `ShopOrderLine` for the customer-facing checkout shape and link forward to the sale via `InvVoucher.shopOrderId` once an operator creates it. Online prices are the **barcode tag price** (shelf == shop == receipt). Payment gateways (Razorpay) are parked — see TODO(payment-gateway).

## URLs

### UI pages — staff side (`src/app/(protected)/office/ecommerce/`)
- `/office/ecommerce/orders` — online orders dashboard.
- `/office/ecommerce/orders/[id]` — order detail (links to the order's sale `InvVoucher` + `ShopOrder`).
- `/office/ecommerce/products` — shop catalogue (subset of `InvProduct` where `isListedInShop = true`).
- `/office/ecommerce/categories` — shop category management.
- `/office/ecommerce/coupons` — discount codes.
- `/office/settings/ecommerce` — shop settings (Publish rules + out-of-stock policy).
- `/office/ecommerce/dashboard` — sales dashboard (revenue, top SKUs).

### UI pages — customer side (`src/app/(external)/`)
- `/`, `/shop`, `/shop/product/[handle]`, `/shop/cart`, `/shop/checkout`, `/shop/order/[id]`, `/shop/wishlist`, `/shop/compare`. See [customer-portal.md](./customer-portal.md) for full list.

### API routes
- **Customer-facing** (`src/app/api/shop/`):
  - `/api/shop/products`, `/api/shop/products/[handle]` — public catalogue (barcode-priced; only shop-**qualified** products returned).
  - `/api/shop/orders` — COD order creation (no payment step); places the order on the sales-orders pipeline at its entry stage.
  - `/api/shop/orders/[id]/razorpay`, `/api/shop/razorpay/webhook` — **parked** (TODO(payment-gateway)); the webhook only records a payment id and never changes order status.
- **Staff** (`src/app/api/ecommerce/`):
  - `/api/ecommerce/orders`, `/api/ecommerce/orders/[id]`, `/api/ecommerce/orders/[id]/status`, `/api/ecommerce/orders/[id]/return-ticket` — order management.
  - `/api/ecommerce/products`, `/api/ecommerce/products/[id]` — catalogue admin (uses unified `InvProduct`).
  - `/api/ecommerce/publish-rules` — GET/PUT the org's configurable shop publish rules.
  - `/api/ecommerce/stock-policy` — GET/PUT the org's out-of-stock policy (HIDE / NOTIFY / BACKORDER).
  - `/api/ecommerce/categories` — shop categories.
  - `/api/ecommerce/coupons`, `/api/ecommerce/coupons/[id]` — promotion codes.

## Permissions (gate keys)

- `ecommerce:manage` — manages catalog + orders.
- (Walk-in / wholesale don't yet have dedicated keys; Accountancy gates the invoice side.)

## Prisma models

- `ShopOrder` + `ShopOrderLine` (in `prisma/schema/shop.prisma`) — online orders. `ShopOrder.orderSource` distinguishes `online` / `phone` / `whatsapp` / `walkin`. `ShopOrder.paymentMethod` (`ShopPaymentMethod` enum, default `COD`; `ONLINE` parked). `pipelineId` + `statusId` are the **source of truth** for order state (the legacy `status` enum is vestigial). Line `unitPricePaise` snapshots the **barcode tag price** at order time. The sale `InvVoucher` is created manually by staff and back-links via `InvVoucher.shopOrderId`.
- `ShopCoupon` (in `prisma/schema/shop.prisma`) — legacy discount codes (percent / fixed); superseded by the unified `Coupon` model (`prisma/schema/coupons.prisma`).
- `InvVoucher` (in `prisma/schema/inventory.prisma`) — covers in-store (POS), wholesale (SALE), and `ShopOrder` confirmations (SALE with `shopOrderId` set). See [inventory.md](./inventory.md) for the full schema, including `InvVoucherTender` (settlement legs) and `InvVoucherCharge` (additional ledger rows).
- `InvProduct` (in `prisma/schema/inventory.prisma`) — the single product source of truth for catalogue + warehouse + POS. The separate `ShopProduct` model was merged into `InvProduct` on 2026-05-04.

`ShopOrderLine.productId` references `InvProduct` directly.

## Key components / library

- `src/modules/external/shop/` — customer-facing storefront components (`ProductDetailTabs`, etc.).
- `src/modules/sales/components/` — staff-side order management UI.
- `prisma/seeds/data/demoCatalogSeed.ts` — seed data for demo products.
- `src/store/external/shopCartStore.ts`, `src/store/external/shopWishlistStore.ts`, `src/store/external/shopCompareStore.ts` — Zustand client stores for cart / wishlist / compare with localStorage persistence.

## Common workflows (wiring)

1. **Online order checkout (COD)** — `/shop/checkout` (customer) → POST `/api/shop/orders` (no payment step). The order is created with `paymentMethod=COD` and placed on the `sales-orders` pipeline (P7) at its entry stage, so it appears as a ticket on the staff orders board. Staff advance it through the pipeline (`transitionOrderPipelineStatus` in `orderStatus.ts`) — **pure status moves, no stock or GL side-effects**. To bill it, staff raise a SALE `InvVoucher` **manually** via the office voucher flow (`/vouchers/sale`) and set its `shopOrderId`; posting that voucher moves stock (`recordStockMovement`) and posts the JE with real GST (`postInvVoucherToGl`). Online line prices are the **barcode tag** (`barcodeTagPaise`), falling back to the effective price when no saved price exists.
2. **In-store walk-in sale** — POS register at `/vouchers/pos` (see [pos.md](./pos.md)) writes a single `InvVoucher` (type=POS) with its own tender rows. No `ShopOrder` row.
3. **Wholesale sale** — staff creates a SALE `InvVoucher` via the `/vouchers/sale` form (TradingVoucherPage); the customer's GL ledger is the AR tender row's `accountId`. No `ShopOrder`.
4. **Return** — staff opens a return ticket against an order at `/office/ecommerce/orders/[id]/return-ticket` → upon approval, a `SALE_RETURN` `InvVoucher` reverses stock and posts the credit-note JE in one shot (see [pos.md](./pos.md) for the same flow at the counter).

## Recent decisions / gotchas

- **No separate ShopProduct** — `InvProduct.isListedInShop` flag controls visibility; same SKU flows through every channel. See [inventory.md](./inventory.md).
- **Shop qualification gate (owner-configurable)** — a product only appears in `/shop` once it meets the org's **publish rules** (`shopQualification` in `src/modules/ecommerce/lib/shopQualification.ts`). Which fields are required (image / description / price / shop category / MRP / in-stock) is chosen by the owner in **Settings → E-Commerce** (`/office/settings/ecommerce`) and stored on `OrgDefaults.shopPublishRulesJson` (null = the default gate: image + description + price). Read it server-side with `loadShopPublishRules()` and via `GET/PUT /api/ecommerce/publish-rules` (gated `ecommerce:manage`). The ecommerce product form gates the "Listed in shop" switch on the rules and auto-lists/auto-slugs qualified products (`resolveShopListing`). Public shop APIs re-check qualification defensively so a stale flag never renders a half-built product. _Note:_ the category check uses the explicit `shopCategory`; the public guard sees the display-resolved category (with the "Accessories" fallback) so it's lenient there — the authoritative gate is at publish time.
- **Out-of-stock policy (owner-configurable + per-product override)** — what the storefront does with a stock-tracked product at zero stock, set org-wide in **Settings → E-Commerce** (`OrgDefaults.shopOutOfStockPolicy`, default `NOTIFY`): `HIDE` (drop from shop), `NOTIFY` (show with an "Out of stock" badge, add-to-cart disabled), `BACKORDER` (accept orders anyway). A product can override to backorder via `InvProduct.allowBackorder` (the "Allow orders when out of stock" toggle on the product form). Pure resolver `resolveAvailability(stock, allowBackorder, policy)` in `src/modules/ecommerce/lib/shopStock.ts` drives storefront visibility + the `stockStatus`/`orderable` fields on `ShopProductPublic`; loaded server-side via `loadShopStockPolicy()`. The shop list/detail APIs + SSR filter `HIDE` and annotate availability; the COD order intake blocks short stock unless backorderable. `null`/untracked stock = always in stock. _Note:_ the demo catalog ships with zero stock, so under `NOTIFY` every demo product shows out-of-stock until real stock is recorded.
- **Barcode price is the shop price** — the storefront and order intake charge `barcodeTagPaise(savedSalePricePaise, mrpPaise, bands)` (shelf == shop == receipt), via `invProductToPublic(p, bands)`. The admin form's editable price stays the effective/strategy price (round-trip safe); the barcode price is shown read-only.
- **Online accounting is manual** — placing/advancing an order books nothing. The old auto path (`createOrderInvVoucher` + crude `postSaleJournal` JE, hardcoded GL codes, no GST) was **removed** to avoid double-booking against the manual SALE voucher.
- **Wholesale channel is planned but partial** — no dedicated UI yet. Use the SALE voucher form (`/vouchers/sale`) manually with the wholesale party's `Account` as the AR tender.
- **Payment gateways parked** — COD is the only live method; Razorpay routes exist but are unused (TODO(payment-gateway)).

## Out of scope / deferred

- Payment gateways (Razorpay / others) — COD-only today (TODO(payment-gateway)).
- Auto-invoice / auto-GL / auto-stock on an order lifecycle event — manual by design in the COD MVP.
- Stock reservation at order placement (small oversell window in the COD flow).
- Server-side cart / wishlist persistence, address book, structured shipping.
- Wholesale-specific UI (price tier display, bulk-quote workflow).
- Subscription / recurring billing.
- Loyalty program integration beyond coupons.
- Walk-in POS terminal UI.

## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|---|---|---|
| `getOrdersPipeline(prisma)`, `assertOrdersStatus(prisma, pipelineId, status)`, `ORDERS_PIPELINE_NAME` | `src/modules/ecommerce/lib/ordersPipeline.ts` | Name-based resolver for the seeded sales-orders pipeline + status validator. |
| `ORDER_STATUS_TRANSITIONS`, `canTransition(from, to)` | `src/modules/ecommerce/lib/orderStatusTransitions.ts` | Legacy `ShopOrderStatus` enum transition graph — used only by the legacy `OrderStatusActions` fallback; pipeline statuses are authoritative. |
| `transitionOrderPipelineStatus` | `src/modules/ecommerce/lib/orderStatus.ts` | Pure pipeline status move for a shop order (no stock/GL side-effects). |
| `shopQualification(p, rules)`, `normalizeShopPublishRules`, `slugifyProduct(name, sku)` | `src/modules/ecommerce/lib/shopQualification.ts` | Pure shop-readiness gate against configurable `ShopPublishRules`, rules normalizer, and slug generator. |
| `loadShopPublishRules()` | `src/shared/lib/shop/publishRules.ts` | Load the org's publish rules (OrgDefaults.shopPublishRulesJson). |
| `resolveShopListing(merged, { explicitListed, bands })` | `src/modules/ecommerce/lib/shopListing.ts` | Decide `isListedInShop` + slug (auto-qualify / enforce / unlist) for product POST/PATCH. |
| `loadBarcodeBands()` | `src/shared/lib/shop/barcodeBands.ts` | Load org barcode bands (`OrgDefaults.barcodeBandsJson`) for barcode-tag pricing. |
| `invProductToPublic(p, bands?)`, `barcodeTagPaise(...)` | `src/shared/lib/shop/productPublic.ts`, `src/shared/lib/pricing/barcodePrice.ts` | Storefront shape; with `bands` the price is the barcode tag (fallback effective). |
| `invProductToAdmin(invProduct, bands?)`, `ShopProductAdmin` (type) | `src/modules/ecommerce/lib/productAdmin.ts` | Admin shape; with `bands` also exposes `savedSalePricePaise` + derived `barcodePricePaise` (display-only). |

_Last updated: 2026-06-06 — **Ecommerce COD MVP rebuild.** Online orders are now Pay-on-Delivery: `/api/shop/orders` creates a `ShopOrder` (new `paymentMethod` `COD`, `ShopPaymentMethod` enum) and places it on the `sales-orders` pipeline (P7) at its entry stage — no payment step. Pipeline moves are pure status changes; the old auto path (`createOrderInvVoucher` DRAFT voucher + crude `postSaleJournal` JE) and `transitionShopOrderStatus` were **removed** — invoicing/GL/stock are now MANUAL via the office SALE voucher. The storefront + order intake price products at the **barcode tag** (`invProductToPublic(p, bands)` / `barcodeTagPaise`). New shop-qualification gate (`shopQualification` + `resolveShopListing`): a product lists only with image+description+price; the ecommerce product form shows a readiness checklist and auto-lists/auto-slugs qualified products. Razorpay routes parked (TODO(payment-gateway)); the webhook no longer transitions or posts. Schema: additive `ShopOrder.paymentMethod` + `ShopPaymentMethod` (plain `db push`). The publish gate is now **owner-configurable** (`OrgDefaults.shopPublishRulesJson`, `GET/PUT /api/ecommerce/publish-rules`, edited in **Settings → E-Commerce** `/office/settings/ecommerce`) — image/description/price/category/MRP each toggleable; default = image + description + price. **Out-of-stock policy** added (`OrgDefaults.shopOutOfStockPolicy` HIDE/NOTIFY/BACKORDER, default NOTIFY; per-product `InvProduct.allowBackorder` override; `resolveAvailability` + `stockStatus`/`orderable` on the public DTO; storefront badges + disabled cart; order intake allows backorder). Additive schema, plain `db push`._
