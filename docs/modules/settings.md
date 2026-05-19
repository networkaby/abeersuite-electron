# Settings

> Cross-cutting configuration: org-wide defaults, ticket pipelines, statuses, sub-statuses, financial-year rollover, naming convention, thermal printer. Carved out of the Admin module on 2026-05-20 so configuration lives separately from RBAC/org-shape (users, roles, branches, departments, posts, org-chart, counters — those stay in [admin.md](./admin.md)).

## URLs

### UI pages (all under `/office/settings/`)
- `/office/settings/org-defaults` — `office/settings/org-defaults/{layout,page}.tsx` — org-wide defaults (unit, GST, HSN, taxability, payment terms, currency).
- `/office/settings/statuses` — `office/settings/statuses/{layout,page}.tsx` — ticket statuses.
- `/office/settings/sub-statuses` — `office/settings/sub-statuses/{layout,page}.tsx` — ticket sub-statuses (with sub-status groups).
- `/office/settings/pipelines` — `office/settings/pipelines/{layout,page}.tsx` — pipeline master.
- `/office/settings/year-ending` — `office/settings/year-ending/{layout,page}.tsx` — financial year close + opening-balance setup, voucher-series FY rollover.
- `/office/settings/naming-convention` — `office/settings/naming-convention/page.tsx` — product name / online name / slug auto-generation (see [inventory.md](./inventory.md) for token semantics). No `layout.tsx` — relies on parent gate + page-level usage.
- `/office/settings/printer-settings` — `office/settings/printer-settings/page.tsx` — thermal printer endpoint + format config. No `layout.tsx`.

> Hard cut, no compat redirects from the legacy `/office/admin/<page>` URLs (user opted out 2026-05-20). The `/office/repairing/settings/*` redirects in `next.config.ts` now point at the new `/office/settings/*` paths.

### API routes (unchanged by the module split)
- `/api/settings/org-defaults` — GET (read singleton, auto-upserts row id=1) + PATCH. Permission: `settings:manage`.
- `/api/pipelines[/[id]]`, `/api/ticket-statuses[/[id]]`, `/api/sub-statuses[/[id]]`, `/api/sub-status-groups[/[id]]`, `/api/status-transitions[/[id]]`, `/api/sub-status-transitions[/[id]]` — pipeline machinery.
- `/api/inventory/naming-config` — GET/PUT for the product naming convention (lives under inventory because the config drives product slug generation).
- `/api/inventory/gst-rates` — read-only options consumed by the org-defaults form for `defaultGstRateId`.

## Permissions (gate keys)

- `settings:manage` — used by org-defaults, year-ending, printer-settings layouts; also gates branches/departments/posts in [admin.md](./admin.md).
- `settings:statuses` (legacy) + `settings:statuses:create`, `settings:statuses:edit`, `settings:statuses:delete` — statuses + sub-statuses pages.
- `settings:pipelines` (legacy) + `settings:pipelines:create`, `settings:pipelines:edit`, `settings:pipelines:delete` — pipelines page.
- `inventory:manage` — naming-convention page (gates the inventory side-effect of slug generation).
- `admin:bypass` — master key, passes every check.

All keys are seeded in `prisma/seeds/bootstrap-seed.ts`. Adding a new permission still requires editing the seed and running `pnpm prisma db seed`.

## Prisma models

- `OrgDefaults` — singleton (id=1) in `prisma/schema/org.prisma`. Fields: `defaultUnitId` (FK → `InvUnit`), `defaultGstRateId` (FK → `GstRate`), `defaultHsnCode`, `defaultTaxability`, `defaultSaleCreditPeriod` (days), `defaultPurchaseCreditPeriod` (days), `defaultCurrencySymbol`. Auto-upserted on first GET; bootstrap seed upserts the row with `defaultGstRateId` pointing to the 18% `GstRate` row. Acts as final fallback in the GST/HSN cascade (after product and all group ancestors return null).
- `Pipeline`, `TicketStatus`, `TicketSubStatus`, `SubStatusGroup`, `StatusTransition`, `SubStatusTransition` (in `prisma/schema/pipeline.prisma`).
- `VoucherSeries` (in `prisma/schema/finance.prisma`) — driven by the Year Ending page; controls FY-aware reference number generation for inventory + GL vouchers (SALE, POS, PURCHASE, ESTIMATE, SALE_RETURN, PURCHASE_RETURN, JOURNAL, INVOICE).

## Key components / library

- `src/modules/settings/components/OrgDefaultsForm.tsx` — client form for org defaults (axios + sonner, no react-hook-form since single flat state). Loads `GstRate` options from `/api/inventory/gst-rates` and renders a Select (not a text input) for `defaultGstRateId`. Moved here from `src/modules/admin/components/` on 2026-05-20.
- `src/shared/lib/schemas/orgDefaultsSchemas.ts` — `orgDefaultsUpdateSchema` (zod). Reusable for downstream wiring (product/voucher defaults).
- `src/shared/lib/auth/makePermissionLayout.tsx` — `makePermissionLayout(permission)` — used by org-defaults, statuses, sub-statuses, pipelines, year-ending layouts.
- `src/modules/inventory/lib/productName.ts` — token list editor + name/slug builders consumed by the naming-convention page.
- `src/modules/accountancy/lib/balance.ts` (`nextRefFromSeries`) + `src/modules/inventory/lib/stock.ts` — consume the FY-aware voucher series rows configured on the Year Ending page.

## Common workflows (wiring)

1. **Create / edit a pipeline** — `/office/settings/pipelines` → calls `/api/pipelines[/[id]]` → ButtonBar reflects the new pipeline immediately for users with appropriate role grants.
2. **Tune org defaults** — `/office/settings/org-defaults` → PATCH `/api/settings/org-defaults` → next product/invoice/PO form picks up the new defaults via the cached `orgDefaults` helper at `src/shared/lib/orgDefaults.ts`.
3. **Rollover financial year** — `/office/settings/year-ending` → writes `VoucherSeries` rows that drive `invNextRef()` (inventory) and `nextRefFromSeries()` (GL). Inventory side reads them in `stock.ts`; preview endpoint at `/api/inventory/vouchers/next-ref`.
4. **Adjust naming convention** — `/office/settings/naming-convention` → PUT `/api/inventory/naming-config`. Token order, separators, slug length, fallback chain all configurable. Inventory Masters page (`/office/inventory/masters`) links to this page from both its tab nav and the configuration card grid.

## Recent decisions / gotchas

- **2026-05-20 — Settings module extracted from Admin.** Pages, OrgDefaultsForm, and module-level doc carved out into their own home. URLs migrated `/office/admin/<page>` → `/office/settings/<page>` with no compatibility redirects (hard cut). Permission keys (`settings:*`) and APIs were not touched.
- **2026-05-20 — `next.config.ts` cleanup.** The legacy redirects `/office/settings/{pipelines,statuses,sub-statuses}` → `/office/{pipelines,...}` (which had been broken since the May 2026 route-group promotion) were deleted to avoid hijacking the new live pages. The `/office/repairing/settings/*` redirects were repointed to the new `/office/settings/*` paths.
- **2026-05-07 — Pipelines / statuses / sub-statuses moved from Repair settings to Admin (`/office/admin/pipelines` etc.).** This 2026-05-20 extraction completes the journey by giving them their own module.
- **Pre-existing inconsistency:** `naming-convention` and `printer-settings` do not carry their own `layout.tsx` (unlike the other 5 settings pages). Permission checks happen at the page or API layer for those two. Preserved as-is during the extraction.

## Out of scope / deferred

- The "Option B" unified settings hub (single overview page with section tiles) — still deferred.
- A runtime UI for adding new permission rows — still requires editing `bootstrap-seed.ts` and reseeding.
- Moving APIs from `/api/pipelines` etc. into an `/api/settings/*` namespace — not part of the 2026-05-20 split.

_Last updated: 2026-05-20 — Module created by extracting 7 pages + OrgDefaultsForm from Admin._
