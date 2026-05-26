# Pricing Strategy

> **Cost → margin → sell price** for every `InvProduct`. A small set of `PricingStrategy` rows defines the markup formula (per BRAND / GROUP / CATEGORY / ORG); per-item knobs (`costMethod`, `marginPercent`, `priceOverridden`) override where needed. The module reads inventory masters, writes back to `InvProduct.pricePaise`, and shares its cost-resolution path with stock valuation so pricing and balance-sheet stock value agree.

## URLs

### UI pages (`src/app/(protected)/office/pricing-strategy/`)
- `/office/pricing-strategy` — overview / landing card.
- `/office/pricing-strategy/strategies` — `PricingStrategy` CRUD: name, scope (ORG/CATEGORY/GROUP/BRAND), scopeId picker for non-ORG scopes, `markupPercent`, `markupFlatPaise`, `roundingPaise`, `priority`, default `costMethod`, active toggle.
- `/office/pricing-strategy/items` — per-SKU pricing table (virtual-scrolled — see commit `1e67df6`). For each product: surfaces matched strategy, effective cost method, resolved cost, computed sell price (with MRP-cap badge when applicable), and an edit row for `costMethod` / `marginPercent` / manual `pricePaise` (locks `priceOverridden=true`) / `stdCostPaise`.
- `/office/pricing-strategy/print-labels` — pick products + qty, render a sheet of **CODE128** barcode labels, send to printer via `window.print()`. Lives here (not in inventory) because a barcode label is only meaningful once a sale price is set. Four layout presets: A4 sheet 3×8 (24 per page), A4 sheet 4×10 (40 per page), Thermal 50×25mm 1-up roll, Thermal 50×25mm 2-up roll (`@page 100mm × 25mm`, breaks after every pair — fits True-Ally-style 2-Ups carriers). Barcode value resolves `barcode1 → sku` per product. Toggles to include/exclude product name, SKU, and price on each label. **Prefill** — opens with `?fromVoucher=<id>` to seed the queue from a voucher's lines (`productId × ceil(quantity)`); used by the "Print labels" action on GRN / PURCHASE rows in any voucher register (added on `VoucherActionsMenu`). Pure client-side — no API; uses `/api/inventory/products/lookup` for the picker and `/api/inventory/vouchers/[id]` for prefill. Rendered via `BarcodeSvg` (`src/modules/inventory/components/BarcodeSvg.tsx`) — single source of truth around `jsbarcode`.
- `/office/pricing-strategy/layout.tsx` — wraps all pages with a tabbed header (Overview / Strategies / Items / Needs attention / Print labels). Full-width by default (no `max-w-*` cap — see commit `006ad9c`).

### API routes (`src/app/api/pricing-strategy/`)
- `strategies` — GET (list, ordered by scope, priority desc), POST (create).
- `strategies/[id]` — GET, PATCH (merged-scope validation: ORG cannot carry `scopeId`; non-ORG must have one), DELETE.
- `items` — GET only. Returns one `PricingItem` row per active `InvProduct`: product fields, matched strategy + effective cost method, resolved cost (via `resolveCostBatch`), computed sell price (with `cappedAtMrp` flag and `rawComputedPricePaise` showing pre-cap), and the strategy's applied markup/flat/rounding so the client can replay the formula live.
- `items/[id]` — PATCH only. Updates per-product knobs (`costMethod`, `marginPercent`, `priceOverridden`, `pricePaise`, `costPaise`, `stdCostPaise`). Setting `pricePaise` implicitly flips `priceOverridden=true` unless the caller explicitly clears it. **Enforces MRP cap**: refuses (HTTP 400) if `pricePaise > InvProduct.mrpPaise`.
- `apply` — POST. Bulk-recomputes `InvProduct.pricePaise` from the resolved cost + matched strategy. Body: `{ productIds?: number[]; forceOverridden?: boolean }`. Default scope = all active products **excluding** `priceOverridden=true`. When `productIds` is given, those exact products are processed (overridden ones still skipped unless `forceOverridden: true`). Returns `{ updated, skipped, errors[] }`. Wrapped in `prisma.$transaction`.

## Permissions (gate keys)

- `inventory:manage` — single key for everything in this module (strategies CRUD, items PATCH, apply). No pricing-specific permission exists or is needed; pricing is treated as part of inventory administration. Seeded by `bootstrap-seed.ts` as part of the standard inventory permissions.

## Prisma models (file: `prisma/schema/inventory.prisma`)

- **`PricingStrategy`** (lines 580+) — the rule row. Fields:
  - `name` — display label.
  - `scope` (`PricingScope` enum: `ORG | CATEGORY | GROUP | BRAND`) + `scopeId Int?` — FK semantics depend on scope (CATEGORY→`InvCategory.id`, GROUP→`InvProductGroup.id`, BRAND→`InvBrand.id`, ORG→null). **App layer enforces the FK; no relation declared**, so deletes of the parent master don't cascade-delete pricing config.
  - `markupPercent Decimal(6,2)` — e.g. `25.00` = +25%.
  - `markupFlatPaise Int` — flat amount added to cost **before** the percent markup.
  - `roundingPaise Int` — round resulting sell price to nearest N paise (0=exact, 100=₹1, 1000=₹10).
  - `priority Int` — tiebreaker within the same scope (higher wins).
  - `costMethod CostMethod?` — **strategy-level default cost method** (added per commit `4cf2136`). Null = no default; products use their own `InvProduct.costMethod` or fall through to `WEIGHTED_AVG_COST`. Per-item `costMethod` always wins when set.
  - `isActive Boolean` — inactive rows ignored by `pickStrategy`.

- **`CostMethod` enum** (`enums.prisma`) — five values used by both pricing and stock valuation:
  `WEIGHTED_AVG_COST`, `FIFO`, `LAST_PURCHASE_COST`, `MONTHLY_AVG_COST`, `STD_COST`.

- **`PricingScope` enum** (`enums.prisma:181`) — `ORG | CATEGORY | GROUP | BRAND`.

- **`InvProduct` columns the module reads/writes**: `costMethod`, `marginPercent` (per-item override of the strategy's markupPercent), `priceOverridden` (lock flag), `pricePaise` (written by `apply` and items PATCH), `stdCostPaise` (consumed by `STD_COST` resolver). `mrpPaise` is read for cap enforcement but never written here.

## Key components / library

- **`src/modules/pricing-strategy/lib/resolveCost.ts`** — cost-basis resolver. `resolveCostBatch(products, method)` returns `Map<productId, ResolvedCost>`. Maps `CostMethod` → unit cost in paise:
  - `WEIGHTED_AVG_COST` / `FIFO` / `LAST_PURCHASE_COST` — delegate to **`valueStockBatch`** in `src/modules/inventory/lib/valuation.ts` so stock valuation and pricing share one source of truth. Converts the valuation module's rupees → paise.
  - `MONTHLY_AVG_COST` — `groupBy InvStockLedger` over IN rows in the current calendar month, weighted `Σ(amount) / Σ(qty)`. Fallback: `no-month-history` → product's cached `costPaise`.
  - `STD_COST` — reads `InvProduct.stdCostPaise` verbatim. Fallback: `no-std-cost` → cached `costPaise`.
  - Single-product wrapper `resolveCost()` exists but is unused by current call sites (both routes call the batch directly).

- **`src/modules/pricing-strategy/lib/resolvePrice.ts`** — sell-price resolver:
  - **`pickStrategy(product, strategies)`** — walks all active strategies; picks most specific by scope rank (`BRAND > GROUP > CATEGORY > ORG`), then by `priority desc`. ORG with `scopeId=null` is always a candidate.
  - **`applyStrategy(costPaise, productMarginOverride, strategy, mrpPaise?)`** — formula: `round((cost + flat) × (1 + markup/100), roundingPaise)`. `productMarginOverride` (i.e. `InvProduct.marginPercent`) wins over `strategy.markupPercent` when set. **MRP cap**: when `mrpPaise > 0`, final price is clamped down to MRP (Indian law — cannot sell above MRP). Pre-cap value preserved in `rawPricePaise`. Strategy `null` → no markup applied (price = cost).
  - **`resolveSellPrice(product, strategies, costPaise, mrpPaise?)`** — one-shot wrapper combining the above two.

- **Pages** — `strategies/page.tsx` (CRUD table), `items/page.tsx` (virtual-scrolled per-SKU pricing grid).

## Common workflows

1. **Set a default strategy** — `/office/pricing-strategy/strategies` → "+ New" → scope `ORG`, no scopeId, `markupPercent` e.g. `25.00` → save. Becomes the fallback for every product without a more specific match.
2. **Override a category/brand/group** — same form, pick scope + scopeId. Higher scope rank wins automatically (BRAND beats GROUP beats CATEGORY beats ORG).
3. **Set a per-item margin** — `/office/pricing-strategy/items` → edit a row, set `marginPercent` to a number. The strategy still matches, but its `markupPercent` is replaced by this value at the top of the chain. Useful for one-off SKUs that need a hand-tuned margin without creating a strategy row.
4. **Lock a manual price** — edit a row, set `pricePaise` directly. `priceOverridden` flips to `true`; bulk-apply will skip this product unless `forceOverridden: true`.
5. **Bulk-recompute everything** — `POST /api/pricing-strategy/apply` with `{}` → updates every non-overridden active product. Passing `{ productIds: [...] }` scopes to that list; passing `{ forceOverridden: true }` also overwrites locked items.

## Recent decisions / gotchas

- **2026-05-25 — Per-strategy default cost method** (`PricingStrategy.costMethod`): strategies can now carry a default cost method that applies to products whose own `InvProduct.costMethod` is null. Resolution: `product.costMethod ?? strategy.costMethod ?? WEIGHTED_AVG_COST`. See commit `4cf2136`.
- **2026-05-25 — Virtual scrolling on Items table**: large product lists now render via virtual scroller in `items/page.tsx`. See commit `1e67df6`.
- **2026-05-25 — Layout uncapped**: `layout.tsx` is full-width (no `max-w-7xl`) so the Items table can breathe. See commit `006ad9c`.
- **`lastPurchasePaise` in the items API is a *cached snapshot*** — `items/route.ts:152` returns `InvProduct.costPaise`, which is the running cost cache updated by purchase posts, not a historical receipt record. Editing it does not retroactively change past invoices. Field is named for UX clarity, not as a historical lookup.
- **`MONTHLY_AVG_COST` uses local-server time** — `resolveCost.ts:142` `startOfCurrentMonth()` calls `new Date()` with no timezone normalization. On a non-IST deploy this would shift the month boundary by the host offset. Fine for the current Windows/dev setup; if production moves to UTC infra, anchor to IST.
- **Items routes have no DELETE by design** — `/api/pricing-strategy/items` exposes GET (list) + `[id]` PATCH only. Items follow `InvProduct` lifecycle: to remove a row from the pricing UI, delete or deactivate the product in inventory. (Open design note — not a hard contract.)
- **Cost resolution is shared with stock valuation** — `resolveCostBatch` delegates `WEIGHTED_AVG_COST` / `FIFO` / `LAST_PURCHASE_COST` to `valueStockBatch` in the inventory module. Any change to the valuation engine affects pricing too. Do NOT inline a parallel implementation here.
- **Strategy resolution is duplicated across `items` and `apply` routes** — both call `pickStrategy(...)` + `applyStrategy(...)` directly rather than going through `resolveSellPrice`. If the resolution order or tie-breaker ever changes, both call sites must update. Mildly fragile; candidate for a future small refactor.
- **`apply/route.ts:68` has a redundant guard** — skips overridden products when `productIds` is empty, but the WHERE clause at line 25 already excludes them in that branch. Unreachable, not a bug. Left as-is.
- **Strategies are not protected math** — the module is NOT listed in `docs/completed-and-protected.md`. Behavior may still evolve; treat `resolveCost` / `resolvePrice` as the source of truth but not yet frozen.
- **Strategy `scopeId` has no DB-level FK** — the schema comment on the model spells this out explicitly: app-layer validation only, so deleting an `InvBrand` / `InvProductGroup` / `InvCategory` will NOT cascade-delete its pricing strategies. Strategies pointing to a deleted scope master simply stop matching anything. Acceptable for now; revisit if orphan strategies become a real problem.

## Out of scope / deferred

- **DELETE endpoint for items** — see gotcha above. If a "remove from pricing view without touching inventory" workflow is needed, build it then.
- **Pricing history / audit log** — no record of what changed when, who applied a bulk update, or what the previous price was. Add when needed.
- **Multi-currency** — single-currency (paise) only.
- **Tiered pricing** (retail / wholesale / repair-centre price columns) — schema doesn't support multiple sell prices per SKU yet; that lives in the broader inventory roadmap.

_Last updated: 2026-05-26 — **Print barcode labels** page moved into this module at `/office/pricing-strategy/print-labels` (originally shipped under inventory; barcode labels are only meaningful once a sale price is set, so this module is the right home). Four layout presets (A4 3×8 / A4 4×10 / Thermal 50×25 1-up / Thermal 50×25 2-up). Layout now exposes a "Print labels" tab. `VoucherActionsMenu` (inventory) gained a "Print labels" action on GRN and PURCHASE rows that deep-links here with `?fromVoucher=<id>` for prefill. Pure client, no new API. Previously (2026-05-25): Initial module doc written as part of the pricing-strategy health audit. Recent commits documented: `4cf2136` per-strategy default cost method, `1e67df6` virtual scrolling on items table, `006ad9c` layout uncapped, `43346c3` AccountancyReportsLayout adjacent fix. Gotchas list captures audit findings #3 (lastPurchasePaise naming), #4 (MONTHLY_AVG_COST tz), #5 (apply route dead guard), #7 (strategy resolution duplication) for future cleanup._
