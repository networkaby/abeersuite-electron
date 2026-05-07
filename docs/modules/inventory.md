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

- `src/modules/inventory/components/InvProductFormFields.tsx` — **tabbed product form** (refactored Step 3 2026-05-07): Basics / Pricing / Stock control / Online listing. Pricing + Online listing tabs are placeholders pending schema additions.
- `src/modules/inventory/components/InvProductPicker.tsx` — autocomplete picker used in voucher forms.
- `src/modules/inventory/components/InvVoucherDetail.tsx` — generic voucher detail view.
- `src/lib/inventory/types.ts` — `invProductDb(prisma)` typed accessor + shared types.
- `src/lib/inventory/schemas.ts` — Zod input schemas.

## Common workflows (wiring)

1. **Create a product** — `/office/inventory/products` → "+ New product" → `InvProductFormFields` (tabs) → POST `/api/inventory/products` → product is automatically available in store + online (controlled by `isListedInShop`) + wholesale + repair.
2. **GRN inward** — `/office/inventory/grn` → "+ New" → POST `/api/inventory/vouchers` (type=GRN) → creates `InvVoucher` + `InvVoucherLine[]` + writes `InvStockLedger` qty+ rows + posts journal to AP.
3. **Sale via shop** — `/shop/checkout` → `ShopOrder` → confirmed → emits `InvVoucher` (type=SALES) → ledger qty- + posts AR/Revenue journal.

## Recent decisions / gotchas

- **2026-05-07 (Step 3)**: form is now tabbed. Pricing + Online tabs are placeholders pending `retailPrice`/`wholesalePrice`/etc. schema additions and full shop-field exposure. Stock control tab holds the existing barcode/EAN/UPC + warranty term identifiers.
- **2026-05-07 (Step 4)**: `InvProduct.ticketParts` relation removed. Inventory no longer back-links to `TicketPart`.
- **GST/HSN drift**: `gstRate`, `hsnCode`, `taxability` columns were added to `InvProduct` via `prisma db push` rather than a migration file. Any future `migrate reset` will lose these columns — they need a proper migration. The schema file already has them.
- **Channels are opt-out, not opt-in**: a product is sellable everywhere unless a flag explicitly restricts.

## Out of scope / deferred

- Pricing tier fields (`retailPrice`, `wholesalePrice`, `repairCentrePrice`) — schema additions not done.
- Multi-warehouse / location-aware stock — single-location only for now.
- Reorder automation — `lowStockThreshold` exists but no consumer.

_Last updated: 2026-05-07 — covers state after Step 3 (tabbed form) + Step 4 (TicketPart relation removed)._
