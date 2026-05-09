# Inventory

> Master data + stock ledger for all SKUs the business sells/services. **One product table (`InvProduct`)** feeds every channel — store, online ecommerce, wholesale, repair-centre. Default behaviour: every product is sellable everywhere unless explicitly restricted via `isListedInShop` etc.

## URLs

### UI pages (`src/app/(protected)/office/(inventory)/inventory/`)
- `/office/inventory` — overview
- `/office/inventory/products` — SKU master + create/edit dialog (tabbed form: Basics / Pricing / Stock control / Online listing — see Step 3 2026-05-07)
- `/office/inventory/units`, `/categories`, `/groups`, `/brands`, `/warranty-terms` — masters
- `/office/inventory/grn`, `/purchase-orders`, `/challans`, `/sales-orders`, `/rejections`, `/stock-journal` — vouchers
- `/office/inventory/stock-ledger` — per-SKU stock movement history
- `/office/inventory/{purchases,sales}/[id]` — voucher detail (cross-references Accountancy invoices)

### API routes (`src/app/api/inventory/`)
- `units`, `categories`, `groups`, `brands`, `warranty-terms` — CRUD masters.
- `products` — `InvProduct` CRUD (search, list, create, edit, photo upload).
- `vouchers` — `InvVoucher` (GRN / PO / Challan / Sales / Rejection) with three-tier lifecycle (cancel/delete/hard-delete).
- `stock-journal`, `stock-ledger`, `physical-stock` — stock movement tracking.

## Permissions (gate keys)

- `inventory:manage` — broad master-data permission for units / categories / brands / warranty terms / `InvProduct`. (Listed under `module: admin` in seed.)
- `inventory:voucher:cancel` / `delete` / `hard-delete` — three-tier on stock vouchers (GRN, PO, etc.).

## Prisma models (file: `prisma/schema/inventory.prisma`)

- `InvProduct` — single SKU master. Used by store, online, wholesale, repair-centre. Has fields for identifiers (sku, barcode1-3, ean1-3, upc1-3, modelNo), categorisation (unitId, categoryId, groupId, brandId, warrantyTermId), shop-listing flags (isListedInShop, slug, shopBadge, shopDescription, galleryJson, specsJson, shopCategory), GST fields (gstRate, hsnCode, taxability — added via `db push` — see Step 4 gotcha).
- `InvUnit`, `InvCategory` (tree), `InvProductGroup`, `InvBrand`, `InvWarrantyTerm` — masters.
- `InvVoucher` + `InvVoucherLine` — GRN / PO / Challan / Sales / Rejection / Stock Journal. Cross-references Accountancy via `JournalEntry`.
- `InvStockLedger` — append-only stock movement log (qty deltas keyed to `InvProduct`).

## Key components / library

- `src/modules/inventory/components/InvProductFormFields.tsx` — **tabbed product form**: Basics / Pricing / Stock control / Opening / Online listing. Pricing + Opening tabs are wired (cost / price / mrp + opening qty / rate / date). Online listing remains a placeholder.
- `src/modules/inventory/components/InvProductPicker.tsx`, `InvProductCombobox.tsx` — autocomplete pickers used in voucher / journal-voucher forms.
- `src/modules/inventory/components/InvVoucherForm.tsx`, `InvVoucherDetail.tsx` — generic voucher form/detail.
- `src/lib/inventory/types.ts` — `invProductDb(prisma)` typed accessor + shared types.
- `src/lib/inventory/schemas.ts` — Zod input schemas.

## Reusable helpers — DO NOT duplicate ⚠️

| Helper | File | Purpose | Use when |
|---|---|---|---|
| **`productOpeningValue(p)`** | `src/modules/inventory/lib/stockValue.ts` | `qty × rate` (returns null if either field missing) | Writing `InvProduct.openingValue` on master save |
| **`syncProductCacheFromOpening(p)`** | same | Returns `{ stock, costPaise }` patch for Prisma — opening qty seeds running stock, opening rate seeds cost basis | Inside any product-write Prisma `data: { ... }` block — spread it: `data: { ...syncProductCacheFromOpening(b), ... }`. Used by POST `/api/inventory/products`, PATCH `/api/inventory/products/[id]`, PUT `/api/inventory/products/[id]/opening` |
| **`productClosingValue(p)`** | same | Per-product live valuation = `stock × costPaise / 100` (0 when stock ≤ 0 or cost null) | Per-row stock value display in any product list / report |
| `getClosingStockValue()` | `src/modules/accountancy/lib/closingStock.ts` | Org-wide stock total — sums `productClosingValue` over all products | Balance Sheet's Stock-in-Hand line; trading adjustment |
| `invNextRef(tx, type)` | `src/modules/inventory/lib/stock.ts` | Sequential reference per InvVoucherType (`SV-2026-0001`, `PV-2026-0001`…) | Inside an inventory voucher transaction |
| `calcLineTotals(line)` / `calcVoucherTotals(lines)` | same | Per-line discount/tax/amount math; voucher subtotal/tax/total | InvVoucher save handlers |

### Architectural rule

`InvProduct.stock` is a **running cache** updated by Purchase/Sale/StockJournal posts and seeded from opening at master-save time. Postgres treats `NULL + n = NULL`, so:
1. New products are inserted with `stock: 0` (not null) — see `syncProductCacheFromOpening` which returns `0` when no opening qty is given.
2. Setting opening on a product overwrites `stock` to the opening qty (last-write-wins). Subsequent vouchers move from there.

For per-product stock-value display, **always use `productClosingValue(p)`** — never `p.stock * p.costPaise / 100` inline. This keeps null/zero handling consistent.

## Common workflows (wiring)

1. **Create a product** — `/office/inventory/products` → "+ New product" → `InvProductFormFields` (tabs) → POST `/api/inventory/products` → if Opening tab filled, `productOpeningValue` writes `openingValue` and `syncProductCacheFromOpening` seeds `stock` + `costPaise` so Balance Sheet's Stock-in-Hand reflects it immediately.
2. **GRN inward** — `/office/inventory/grn` → "+ New" → POST `/api/inventory/vouchers` (type=GRN) → creates `InvVoucher` + `InvVoucherLine[]` + writes `InvStockLedger` qty+ rows + posts journal to AP.
3. **Sale via shop** — `/shop/checkout` → `ShopOrder` → confirmed → emits `InvVoucher` (type=SALES) → ledger qty- + posts AR/Revenue journal.
4. **Adjust on-hand stock** — `/office/inventory/physical-stock/new` → enter counted qty per product → POST handler treats qty as new on-hand value, computes delta, writes `InvStockLedger`, updates `InvProduct.stock` cache.
5. **Tally journal voucher with inventory consumption** — `JournalVoucherDialog` (from accountancy module, accessible anywhere via `useJournalVoucherStore`) → POST `/api/finance/journal-vouchers` with `stockItems` per line → atomic Voucher + JE + STOCK_JOURNAL InvVoucher carrier + InvStockLedger entry. Items only allowed under INCOME/EXPENSE ledgers (gated by `isStockEligibleAccount` from accountancy).

## Recent decisions / gotchas

- **2026-05-07 (Step 3)**: form is now tabbed. Stock control tab holds the existing barcode/EAN/UPC + warranty term identifiers.
- **2026-05-07 (Step 4)**: `InvProduct.ticketParts` relation removed. Inventory no longer back-links to `TicketPart`.
- **2026-05-09 — Pricing + Opening tabs wired**: Pricing tab now writes `costPaise / pricePaise / mrpPaise` (rupees in UI, paise in DB). New Opening tab writes `openingStock / openingRate / openingValue / openingStockDate` directly to the master row (no voucher in between). Online listing tab is still a placeholder.
- **2026-05-09 — Stock cache must be 0, not null**: `InvProduct.stock` defaults to `0` on insert (not `null`). Postgres returns `NULL + n = NULL`, so a null cache silently breaks every Purchase/Sale increment downstream. Use `syncProductCacheFromOpening` in any product-write endpoint — it returns `stock: 0` when no opening qty is given.
- **2026-05-09 — Opening sync is destructive on PATCH**: when opening qty/rate change, the cache is overwritten (last-write-wins). Subsequent Purchase/Sale vouchers move from the new baseline. To change `costPaise` without touching opening, set explicit `costPaise` in the Pricing tab — it merges last and wins.
- **GST/HSN drift**: `gstRate`, `hsnCode`, `taxability` columns were added to `InvProduct` via `prisma db push` rather than a migration file. Any future `migrate reset` will lose these columns — they need a proper migration. The schema file already has them.
- **Channels are opt-out, not opt-in**: a product is sellable everywhere unless a flag explicitly restricts.
- **2026-05-09 — All inventory masters are dummy data**: `InvUnit`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvWarrantyTerm`, `InvProduct` are seeded **only** by `dummy-shop.ts`. `bootstrap-seed.ts` doesn't touch any of them. `pnpm seed:hard-clean` wipes them all. Real production users create masters via the UI; dummy-shop is for demo only.

## Out of scope / deferred

- Pricing tier fields (`retailPrice`, `wholesalePrice`, `repairCentrePrice`) — schema additions not done. The current `costPaise` / `pricePaise` / `mrpPaise` cover the basics.
- Multi-warehouse / location-aware stock — single-location only for now.
- Reorder automation — `lowStockThreshold` exists but no consumer.

_Last updated: 2026-05-09 — added stockValue helper module, Pricing + Opening tabs wired with direct DB writes, stock-cache sync rule, journal-voucher inventory consumption flow._
