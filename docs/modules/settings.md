# Settings

> Cross-cutting configuration: org-wide defaults, ticket pipelines, statuses, sub-statuses, financial-year rollover, naming convention, thermal printer. Carved out of the Admin module on 2026-05-20 so configuration lives separately from RBAC/org-shape (users, roles, branches, departments, posts, org-chart, counters — those stay in [admin.md](./admin.md)).

## URLs

### Layout / in-section nav
- `office/settings/layout.tsx` — SSR shell; passes session permissions to `SettingsNav`. Wraps **all** settings routes, including pages without their own `layout.tsx`.
- `src/modules/admin/components/SettingsNav.tsx` — client grouped tab bar (Org config → Workflow → Inventory → Hardware). Items and permissions come from `SETTINGS_NAV` in `src/utils/constants.ts`.

### UI pages (all under `/office/settings/`)
- `/office/settings/org-defaults` — `office/settings/org-defaults/{layout,page}.tsx` — org-wide defaults (unit, GST, HSN, taxability, payment terms, currency).
- `/office/settings/statuses` — `office/settings/statuses/{layout,page}.tsx` — ticket statuses.
- `/office/settings/sub-statuses` — `office/settings/sub-statuses/{layout,page}.tsx` — ticket sub-statuses (with sub-status groups).
- `/office/settings/pipelines` — `office/settings/pipelines/{layout,page}.tsx` — pipeline master.
- `/office/settings/year-ending` — `office/settings/year-ending/{layout,page}.tsx` — financial year close + opening-balance setup, voucher-series FY rollover.
- `/office/settings/naming-convention` — `office/settings/naming-convention/page.tsx` — product name / online name / slug auto-generation (see [inventory.md](./inventory.md) for token semantics). No per-page `layout.tsx` — permission gate at page/API layer; parent `settings/layout.tsx` supplies in-section nav.
- `/office/settings/printer-settings` — `office/settings/printer-settings/page.tsx` — thermal printer endpoint + format config. No per-page `layout.tsx`; parent layout supplies nav.
- `/office/settings/backup-restore` — `office/settings/backup-restore/{layout,page}.tsx` — full-DB `pg_dump` download + `pg_restore` upload. Gated by `settings:manage`. See gotchas re: `DIRECT_DATABASE_URL` env + `pg_dump` binary requirement.
- `/office/settings/item-import` — `office/settings/item-import/{layout,page}.tsx` — CSV product importer with column-mapping UI. Upload any CSV, map source columns to product fields (with auto-suggest), pick Skip / Update for existing SKUs, preview (no writes), then commit. Gated by `inventory:manage` (the importer writes to `InvProduct`).
- `/office/settings/voucher-templates` — `office/settings/voucher-templates/{layout,page}.tsx` — per-kind voucher template editor. Left column lists all 21 voucher kinds (Accounting + Inventory groups); right pane shows form + live `<ReceiptPreview>`. Includes a "Default paper" radio (A4 / Thermal 80mm) per kind, plus a "Preview as" toggle so you can flip the preview between formats without changing the default. Save / Reset-to-defaults / Discard buttons. Gated by `settings:manage`.
- `/office/settings/voucher-templates/preview` — `office/settings/voucher-templates/preview/{layout,page}.tsx` — read-only side-by-side gallery showing A4 and Thermal previews of the selected kind. "Default · prints today" badge highlights which paper the kind would print on if you clicked the receipt button right now. Intended for client demos. Gated by `settings:manage`.

> Hard cut, no compat redirects from the legacy `/office/admin/<page>` URLs (user opted out 2026-05-20). The `/office/repairing/settings/*` redirects in `next.config.ts` now point at the new `/office/settings/*` paths.

### API routes (unchanged by the module split)
- `/api/settings/org-defaults` — GET (read singleton, auto-upserts row id=1) + PATCH. Permission: `settings:manage`.
- `/api/settings/backup` — POST. Streams a `pg_dump --format=custom` of the whole DB as a download. Permission: `settings:manage`.
- `/api/settings/restore` — POST multipart (`dump` file + `confirm=RESTORE`). Runs `pg_restore --clean --if-exists`; replaces all current data. Permission: `settings:manage`.
- `/api/settings/item-import/preview` — POST `{ rows, mode }`. Validates without writing; returns `{ willCreate, willUpdate, willSkip, errorCount, results[] }`. Permission: `inventory:manage`.
- `/api/settings/item-import/commit` — POST `{ rows, mode }`. Same validation as preview, then writes inside one transaction. Permission: `inventory:manage`.
- `/api/settings/voucher-templates` — GET list of all 21 `VoucherPrintTemplate` rows; defensively upserts missing kinds. Permission: `settings:manage`.
- `/api/settings/voucher-templates/[kind]` — GET single row (auto-upserts with defaults if missing) + PUT partial update. Body validated by `voucherTemplateUpdateSchema`. Permission: `settings:manage`.
- `/api/settings/voucher-templates/[kind]/reset` — POST → re-upserts the row with bootstrap defaults from `buildVoucherTemplateDefaults(kind)`. Permission: `settings:manage`.
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
- `VoucherPrintTemplate` (in `prisma/schema/finance.prisma`) — one row per voucher kind (21 total: 6 `VoucherType` + 15 `InvVoucherType`). Stores header text, body toggles (show GSTIN / address / tax-summary / signature), footer text + terms, `defaultPaper` (`"A4" | "THERMAL_80MM"`), and thermal paper geometry (width / font family / font size). `kind` PK is a string; bootstrap seed populates every kind via `buildVoucherTemplateDefaults`. Re-seed forces `defaultPaper` back to its per-kind baseline (POS = thermal, everything else = A4) but leaves all other admin customisations alone.

## Key components / library

- `src/modules/admin/components/SettingsNav.tsx` — in-section nav for all `/office/settings/*` pages (lives under admin module folder because it was introduced alongside `AdminNav`; consumed only by settings layout).
- `SETTINGS_NAV` in `src/utils/constants.ts` — single source of truth for settings tab labels, icons, hrefs, and permission keys (sidebar + `SettingsNav`).
- `src/modules/settings/components/OrgDefaultsForm.tsx` — client form for org defaults (axios + sonner, no react-hook-form since single flat state). Loads `GstRate` options from `/api/inventory/gst-rates` and renders a Select (not a text input) for `defaultGstRateId`. Moved here from `src/modules/admin/components/` on 2026-05-20.
- `src/modules/settings/components/BackupRestorePanel.tsx` — client component for the Backup & Restore page. Uses `fetch` + blob download for backup; multipart upload + typed `RESTORE` confirmation for restore.
- `src/modules/settings/components/ItemImportPanel.tsx` — client component for the Item Import page. Parses the CSV client-side via `parseCsv`, auto-suggests column → product-field mappings via `autoSuggestField`, posts normalized JSON rows to the preview / commit endpoints.
- `src/shared/lib/import/csvParse.ts` — tiny RFC-4180-subset CSV parser. Handles quoted fields, embedded commas/newlines, escaped quotes. No dependency.
- `src/shared/lib/import/productImport.ts` — server-side validator + writer. Exports `PRODUCT_IMPORT_FIELDS`, `runProductImport({ rows, mode, dryRun })`. Loads all masters once, resolves FK names → ids in memory, reuses `generateSku`, `productOpeningValue`, `syncProductCacheFromOpening`. Commit path runs inside one `$transaction` so a mid-batch failure rolls back.
- `src/shared/lib/backup/directDatabaseUrl.ts` — resolves the direct (port 5432) Postgres URL used by `pg_dump`/`pg_restore`. Prefers `DIRECT_DATABASE_URL`; falls back to swapping `:6543` → `:5432` on `DATABASE_URL`.
- `src/shared/lib/schemas/orgDefaultsSchemas.ts` — `orgDefaultsUpdateSchema` (zod). Reusable for downstream wiring (product/voucher defaults).
- `src/shared/lib/auth/makePermissionLayout.tsx` — `makePermissionLayout(permission)` — used by org-defaults, statuses, sub-statuses, pipelines, year-ending layouts.
- `src/modules/inventory/lib/productName.ts` — token list editor + name/slug builders consumed by the naming-convention page.
- `src/modules/accountancy/lib/balance.ts` (`nextRefFromSeries`) + `src/modules/inventory/lib/stock.ts` — consume the FY-aware voucher series rows configured on the Year Ending page.
- `src/modules/settings/components/VoucherTemplatesPanel.tsx` — client component for the Voucher Templates page. Holds working-copy + last-saved-baseline maps so the "Save / Reset / Discard" buttons and unsaved-changes dots are derived from a single source. Renders the form alongside `<ReceiptPreview previewMode />` with a "Preview as" toggle that flips between A4 / Thermal / "As default" without touching the saved row.
- `src/modules/settings/components/VoucherTemplatesPreviewGallery.tsx` — client component for the demo gallery page. Kind dropdown + side-by-side A4 / Thermal `<ReceiptPreview previewMode />` panes; the default paper for the kind gets a "prints today" badge.
- `src/modules/settings/lib/voucherTemplateSamples.ts` — shared per-kind sample data (`buildSampleForKind`) + `VOUCHER_KIND_LABEL` map. Reused by the editor and the gallery so both pages preview identical sample numbers.
- `src/shared/components/print/ReceiptPreview.tsx` — thin dispatcher. Picks `<A4InvoicePreview>` or `<ThermalReceiptPreview>` based on the `format` prop. Both children share the same `template + sample` shape.
- `src/shared/components/print/A4InvoicePreview.tsx` — A4 layout: letterhead with logo/brand/address/GSTIN/phone, "Tax Invoice" banner (uses `headerLine2`), Bill-To / Voucher-Details two-column band, S.No · Description · Qty · Rate · Amount table, totals box, amount-in-words line, terms + signature + footer.
- `src/shared/components/print/ThermalReceiptPreview.tsx` — 80mm thermal layout: company name, optional address/GSTIN/phone, reference + party + dashed-line items + totals + terms + signature + footer. When `previewMode` is true both components return just their sheet (for in-page rendering); otherwise they return a full standalone HTML document for the `/receipt/invoice/[id]` print route.
- `src/shared/lib/print/voucherTemplate.ts` — `getVoucherTemplate(kind)` server helper + `resolvePaperFormat(template, urlOverride)` which decides A4 vs Thermal at print time (URL `?paper=` wins; otherwise the row's `defaultPaper`).
- `src/shared/lib/print/voucherTemplateDefaults.ts` — single source of truth: `VOUCHER_TEMPLATE_KINDS`, `VOUCHER_TEMPLATE_KIND_GROUPS` (accounting / inventory), `PAPER_FORMATS` + `isPaperFormat`, `buildVoucherTemplateDefaults(kind)` (POS → thermal default, all others → A4 default). Imported by bootstrap seed, API routes, and the settings UI.
- `src/shared/lib/format/numberToWords.ts` — Indian-system rupees → words (`rupeesInWords(3178.92)` → `"Rupees Three Thousand One Hundred Seventy Eight and Ninety Two Paise Only"`). Used by the A4 layout under the grand total.
- `src/shared/lib/schemas/voucherTemplateSchemas.ts` — `voucherTemplateUpdateSchema` (zod) for the PUT body + `voucherTemplateKindSchema` for URL-param validation. Includes `defaultPaper: z.enum(PAPER_FORMATS)`.

## Common workflows (wiring)

1. **Create / edit a pipeline** — `/office/settings/pipelines` → calls `/api/pipelines[/[id]]` → ButtonBar reflects the new pipeline immediately for users with appropriate role grants.
2. **Tune org defaults** — `/office/settings/org-defaults` → PATCH `/api/settings/org-defaults` → next product/invoice/PO form picks up the new defaults via the cached `orgDefaults` helper at `src/shared/lib/orgDefaults.ts`.
3. **Rollover financial year** — `/office/settings/year-ending` → writes `VoucherSeries` rows that drive `invNextRef()` (inventory) and `nextRefFromSeries()` (GL). Inventory side reads them in `stock.ts`; preview endpoint at `/api/inventory/vouchers/next-ref`.
4. **Adjust naming convention** — `/office/settings/naming-convention` → PUT `/api/inventory/naming-config`. Token order, separators, slug length, fallback chain all configurable. Inventory Masters page (`/office/inventory/masters`) links to this page from both its tab nav and the configuration card grid.
5. **Customise a voucher print template** — `/office/settings/voucher-templates` → pick a kind → edit fields (including `defaultPaper`) → PUT `/api/settings/voucher-templates/[kind]`. The next print from `/receipt/invoice/[id]?kind=...` reads the row on every request (no caching), so changes show up immediately. Paper format is resolved by `resolvePaperFormat`: the URL `?paper=A4` / `?paper=THERMAL_80MM` wins; otherwise the row's `defaultPaper` applies. POS sales pass `?kind=POS` (thermal default); sale invoices use `?kind=SALE` (A4 default). Reset-to-defaults re-applies the bootstrap row from `buildVoucherTemplateDefaults`.
6. **Demo a voucher print to a client** — `/office/settings/voucher-templates/preview` → pick the kind in the dropdown → side-by-side A4 and Thermal panes update immediately. The pane with the "Default · prints today" badge is the one that would come out of the printer if you clicked the receipt button on a real voucher of this kind right now.

## Recent decisions / gotchas

- **2026-05-20 (V1.5 complete)**: `office/settings/layout.tsx` + `SettingsNav`. Grouped in-section tabs (org → workflow → inventory → hardware); `admin:bypass` or per-item permission gates visibility. Naming-convention and printer-settings gain the tab bar via the parent layout even though they still lack per-page `layout.tsx`. Preserve-first in [completed-and-protected.md](../completed-and-protected.md).
- **2026-05-20 — Settings module extracted from Admin.** Pages, OrgDefaultsForm, and module-level doc carved out into their own home. URLs migrated `/office/admin/<page>` → `/office/settings/<page>` with no compatibility redirects (hard cut). Permission keys (`settings:*`) and APIs were not touched.
- **2026-05-20 — `next.config.ts` cleanup.** The legacy redirects `/office/settings/{pipelines,statuses,sub-statuses}` → `/office/{pipelines,...}` (which had been broken since the May 2026 route-group promotion) were deleted to avoid hijacking the new live pages. The `/office/repairing/settings/*` redirects were repointed to the new `/office/settings/*` paths.
- **2026-05-07 — Pipelines / statuses / sub-statuses moved from Repair settings to Admin (`/office/admin/pipelines` etc.).** This 2026-05-20 extraction completes the journey by giving them their own module.
- **Per-page layout gap (unchanged):** `naming-convention` and `printer-settings` still have no dedicated `layout.tsx` (unlike the other five pages that use `makePermissionLayout`). Permission checks remain at the page or API layer. The parent `settings/layout.tsx` (V1.5) now supplies in-section nav for both.
- **2026-05-23 — Item Import page.** CSV product importer under Settings. Client parses CSV (`src/shared/lib/import/csvParse.ts`) so the server only sees normalized JSON rows + a mapping. Auto-suggests column mapping based on header name (e.g. "Product Name" → `name`). FK resolution is by name/code lookup against existing masters — does NOT auto-create masters (avoid typo-driven duplicates). Skip/Update toggle decides what happens for existing SKUs. Reuses the same field-write logic as `POST /api/inventory/products` via shared helpers (`generateSku`, `productOpeningValue`, `syncProductCacheFromOpening`). Commit runs in a single `$transaction`.
- **2026-05-23 — Backup & Restore page.** Shells out to `pg_dump` / `pg_restore`, so the Node server's host needs the Postgres client binaries on `PATH`. Works on local dev (PostgreSQL 17.9 verified) and self-hosted Node, **not** on serverless deploys like Vercel. The pooled `DATABASE_URL` (pgbouncer, port 6543) does not work for these binaries — set `DIRECT_DATABASE_URL` from Supabase → Settings → Database → Direct connection (port 5432), or let the helper auto-swap the port. Restore is destructive (`--clean --if-exists`); requires `settings:manage` + a typed `RESTORE` confirmation + a `window.confirm` second prompt. `admin:bypass` was the original gate but is an env-super-admin-only sentinel (never seeded), so any normal admin user got redirected — switched to `settings:manage` to match the rest of the settings module.
- **2026-05-23 — Voucher Templates page + A4/Thermal dual layout + demo gallery.** Per-kind voucher template editor under Settings. **Both A4 and 80mm thermal are supported** — each kind has a `defaultPaper` field that picks which one its receipts print on by default. POS defaults to thermal (counter printer); SALE / PURCHASE / RECEIPT / etc default to A4 (formal tax invoice). **Per-kind** because SALE / POS / RECEIPT / GRN / journal-style vouchers genuinely diverge (sub-titles, tax summary visibility, signature line). All 21 kinds get a row in `VoucherPrintTemplate`; the bootstrap seed is **create + only-force-defaultPaper on re-run** so customisations to header/footer/toggles survive `pnpm prisma db seed`, but the per-kind paper baseline is restored. The reset-to-defaults endpoint wipes a row back to the canonical defaults. `headerLine1 === ""` falls back to `COMPANY_DETAILS.brandName` so existing seeded data prints with the same brand as before until a user customises. Logo handling: a `logoUrl` text field + `showLogo` toggle, no Cloudinary upload UI in V1. `showQrCode` is a reserved field — the current renderer ignores it. The demo gallery at `/office/settings/voucher-templates/preview` is the page to open on a client demo — it shows A4 and Thermal previews side-by-side with a "prints today" badge marking the default. Only `/receipt/invoice/[id]` is wired today (POS path passes `?kind=POS`; non-POS calls default to `?kind=SALE`); the ticket job-receipt at `/receipt/[id]` is **not** a voucher and was intentionally left alone. The A4 layout deliberately ships without per-line CGST/SGST/IGST columns and without amount-in-words for word currencies other than rupees — both are deferred until invoice-line schema work exposes the tax split.

## Out of scope / deferred

- The "Option B" unified settings hub (single overview page with section tiles) — still deferred.
- A runtime UI for adding new permission rows — still requires editing `bootstrap-seed.ts` and reseeding.
- Moving APIs from `/api/pipelines` etc. into an `/api/settings/*` namespace — not part of the 2026-05-20 split.

_Last updated: 2026-05-23 — added Voucher Templates editor + Voucher Preview demo gallery; A4 layout (`<A4InvoicePreview>`) joins the existing thermal 80mm layout via a `<ReceiptPreview>` dispatcher; per-kind `defaultPaper` chooses which one prints by default, with `?paper=` URL override._
