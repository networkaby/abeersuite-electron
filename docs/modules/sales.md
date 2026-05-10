# Sales

> Sale-side activity across **store** (walk-in retail), **online** (ecommerce / shop), and **wholesale** (planned). Each channel writes the same data: `ShopOrder` for online, `Invoice` for direct (in-store + wholesale), with stock movement reflected via `InvVoucher` (type=SALES) into `InvStockLedger`.

## URLs

### UI pages
- `/office/ecommerce/orders` — online orders dashboard
- `/office/ecommerce/orders/[id]` — order detail (links to `Invoice` + `ShopOrder`)
- `/office/ecommerce/products` — shop catalog (subset of `InvProduct` where `isListedInShop = true`)
- `/office/ecommerce/coupons` — discount codes
- `/office/ecommerce/dashboard` — sales dashboard (revenue, top SKUs)
- `/office/ecommerce/return-tickets` — return-merchandise authorisation

### API routes (`src/app/api/`)
- `/api/shop-orders[/[id]]` — staff-side order management.
- `/api/coupons[/[id]]` — promotion codes.
- `/api/sales/dashboard` — aggregations.
- `/api/return-tickets[/[id]]` — RMA workflow.

## Permissions (gate keys)

- `ecommerce:manage` — manages catalog + orders.
- (Walk-in / wholesale don't yet have dedicated keys; Accountancy gates the invoice side.)

## Prisma models (file: `prisma/schema/sales.prisma`)

- `ShopOrder` + `ShopOrderLine` — online orders. `ShopOrder.orderSource` distinguishes `online` / `phone` / `whatsapp` / `walkin`.
- `Coupon` — discount codes (percent / fixed).
- `ReturnTicket` — RMA.
- `Invoice` (in `prisma/schema/finance.prisma`) — covers in-store + wholesale + ShopOrder confirmations.

`ShopOrderLine` references `InvProduct` directly (no separate `ShopProduct` — merged Phase 2).

## Key components / library

- `src/modules/external/shop/` — customer-facing storefront components (`ProductDetailTabs`, etc.).
- `src/modules/sales/components/` — staff-side order management UI.
- `prisma/seeds/data/demoCatalogSeed.ts` — seed data for demo products.
- `src/store/shopCartStore.ts`, `wishlistStore.ts`, `compareStore.ts` — Zustand client stores for cart / wishlist / compare with localStorage persistence.

## Common workflows (wiring)

1. **Online order checkout** — `/shop/checkout` (customer) → POST `/api/shop-orders` with Razorpay payment → confirmed → emits a sale `InvVoucher` + `Invoice`. The `Invoice.shopOrderId` links back.
2. **In-store walk-in sale** — staff creates an `Invoice` directly via Accountancy (no `ShopOrder`). `Invoice.accountId` points at the customer's GL ledger.
3. **Apply coupon** — checkout calls `/api/coupons/validate` → updates `ShopOrder.discountAmount`.
4. **Return** — customer or staff creates `ReturnTicket` → upon approval, posts a credit note via Accountancy + reverses stock via `InvVoucher` (type=REJECTION).

## Recent decisions / gotchas

- **No separate ShopProduct** — `InvProduct.isListedInShop` flag controls visibility; same SKU flows through every channel. See [inventory.md](./inventory.md).
- **Wholesale channel is planned but partial** — no dedicated UI yet. Use Accountancy invoices manually with the wholesale party's `Account`.
- **Razorpay** is the only payment gateway today.

## Out of scope / deferred

- Wholesale-specific UI (price tier display, bulk-quote workflow).
- Subscription / recurring billing.
- Loyalty program integration beyond coupons.
- Walk-in POS terminal UI.

_Last updated: 2026-05-07._
