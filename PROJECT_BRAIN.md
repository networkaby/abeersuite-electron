# PROJECT BRAIN — ServiceMgmt

> Internal business OS for a multi-channel computer & CCTV shop — retail (in-store + online), wholesale, and a repair service centre on one shared inventory and accounting backbone.

**Stack:** Next.js 16.2.3 (App Router, Turbopack), React 19, PostgreSQL (Supabase), Prisma 7.7.0 (split schema), NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Zustand 5, Sonner, Axios, React Hook Form, Zod, Razorpay, Cloudinary, Sentry.
**Repo:** `D:\our-own-website\service-mgmt-experiment` — branch `dev`.
**Started:** 2026-04-17.
**Last updated:** 2026-06-01.

This file is the **only doc that carries status**. Architecture lives in [ARCHITECTURE.md](ARCHITECTURE.md). Setup/runbook lives in [README.md](README.md). Contributor rules live in [AGENTS.md](AGENTS.md). For the authoritative history, read `git log`.

---

## 🎯 Goal

Replace paper/spreadsheets across the whole business with one app:

- **Repair tickets** — Received → Diagnosing → Repairing → … → Returned, with role handoffs (Front Desk, Technician, Despatch, Admin).
- **Accounting** — Tally-style GL: vouchers, GST/HSN, BS / P&L / Day Book / Trial Balance, audit trails.
- **Unified inventory** — one `InvProduct` master feeds storefront, repair, POS, wholesale.
- **POS** — counter-based tills, shift lifecycle, sale returns.
- **CRM & leads** — kanban pipeline reusing the Ticket engine.
- **Customer shop + portal** — `/shop` + `/portal` (separate `CustomerPortalCredential` auth).
- **Org / RBAC** — multi-branch, multi-department, rank-gated roles with `area:operation:scope` permissions.

---

## 🔄 In flight

- **2026-05-29 — Backup & Restore → Dropbox, fire-and-forget** (on `dev`, PR pending). `pg_dump`/`pg_restore` run in GitHub Actions; the dump is stored in / read from **Dropbox** instead of Supabase Storage; the UI only triggers the run and no longer polls (close the page anytime). Backup lands in Dropbox; restore picks from a Dropbox list. New `src/shared/lib/backup/dropbox.ts` + `/api/settings/restore/list`; removed `/backup/status`, `/restore/upload-url`, `/restore/status`, `backupStorage.ts`. **Pending before prod:** one-time Dropbox scoped-app setup (`DROPBOX_APP_KEY/SECRET/REFRESH_TOKEN`) in GitHub secrets + Vercel env, then merge `dev → main`.

---

## 🆕 Recently shipped (last ~10)

Older history lives in `git log`. This section is trimmed; don't grow it past ~10 entries.

- **2026-06-07 — O2C Phase 1: POS Estimate mode (price-privacy quote → captures a Deal)**: POS is now **mode-first** — a `PosModeSwitch` (Sale / Order / Estimate, colour-coded) on the party bar of both the existing POS screen (additive, sale logic untouched) and a new slim **Estimate page** at `/vouchers/pos/estimate` (its own full-screen shell, separate from the frozen POS Sale voucher). Estimate mode prints the **barcode/tag (cap) price with all discounts stripped** (price privacy, verbal negotiation) — verified end-to-end: the printed `ESTIMATE / QUOTATION` shows the tag price (₹273), never the strategy price. New isolated `POST /api/pos/estimate` (gated by `accountancy:view:org`, same as POS sale — no `deals:manage` needed) creates an **`ESTIMATE` InvVoucher** (no stock, no GL — reuses the existing voucher type + `invNextRef`/`calcLineTotals`) and, when a party is attached, **captures a CRM Deal** (find-or-create the party's open deal via new `findOpenDealForParty` dedup, stamp a SYSTEM activity, soft-link `InvVoucher.dealId`). Anonymous estimate = quote only, no deal. Schema is additive (`InvVoucher.dealId` ↔ `Deal.vouchers`, plain `db push`; seeds unaffected — neither bootstrap nor dummy create InvVouchers). Also passed the tx through `{ timeout: 30_000, maxWait: 10_000 }` after hitting P2028 on the pooler (see [[interactive_tx_timeout_p2028]] pattern). First slice of the [O2C redesign](docs/srs/order-to-cash.md). _Order mode button is rendered disabled ("coming soon") — Phase 3._
- **2026-06-06 — Ecommerce COD MVP (rebuild of the legacy shop order flow)**: online orders are now **Pay-on-Delivery** and ride the seeded **`sales-orders` pipeline (P7)** as their single source of truth. `POST /api/shop/orders` creates a `ShopOrder` with the new `paymentMethod` (`ShopPaymentMethod` enum, default `COD`, `ONLINE` parked) and drops it on the pipeline entry stage — checkout no longer calls Razorpay (`/shop/checkout` → "Place COD order"). Pipeline transitions (`transitionOrderPipelineStatus`) are now **pure status moves**: the old auto path — a DRAFT SALE voucher (`createOrderInvVoucher`) on "Confirmed" plus a **crude hardcoded JE** (`postSaleJournal`, codes `1010`/`4150`, no GST/AR) on "Paid" — was **removed**, killing the double-book hazard and the bypassed stock ledger; **invoice + delivery + GL + stock are all manual** via the office SALE voucher (which posts stock via `recordStockMovement` + GL with real GST via `postInvVoucherToGl`). `transitionShopOrderStatus` deleted; the Razorpay webhook is parked (records a payment id only, never transitions — `TODO(payment-gateway)`). **Shop now shows the barcode tag price** (`invProductToPublic(p, bands)` → `barcodeTagPaise`, fallback effective) so shelf == shop == receipt; order lines snapshot that price. New **shop-qualification gate** (`shopQualification` + `resolveShopListing` + `slugifyProduct`): a product lists only with image+description+price; the ecommerce product form shows a readiness checklist, gates the "Listed in shop" switch, and auto-lists/auto-slugs qualified products; public shop APIs re-check defensively. Schema is additive (`ShopOrder.paymentMethod` + `ShopPaymentMethod`, plain `db push`). New helpers: `src/shared/lib/shop/barcodeBands.ts`, `src/modules/ecommerce/lib/{shopQualification,shopListing}.ts`. The publish gate is **owner-configurable** (`OrgDefaults.shopPublishRulesJson` + `GET/PUT /api/ecommerce/publish-rules` + **Settings → E-Commerce** `/office/settings/ecommerce`): image/description/price/shop-category/MRP/in-stock each toggleable, default = image+description+price (edited in **Settings → E-Commerce** `/office/settings/ecommerce`; the settings page retries on load and disables Save until the real state loads so a failed GET can't mask/overwrite saved rules). An **out-of-stock policy** was added (org-wide `OrgDefaults.shopOutOfStockPolicy` HIDE/NOTIFY/BACKORDER, default NOTIFY, + per-product `InvProduct.allowBackorder` override): `resolveAvailability` drives storefront visibility + `stockStatus`/`orderable` on the public DTO, with out-of-stock badges / disabled cart / backorder labels and order-intake backorder support (`/api/ecommerce/stock-policy`). The Products admin was also reworked (All/Published/Pending tabs, Brand/Group columns, Category/Brand/Group/Status/Stock/Active filters, expandable rows, sticky scroll, breadcrumb + Esc) and the module promoted out of the `(to-do)` route group with sidebar nav enabled. **Orders list redesigned** (pipeline-status badges, status tabs, channel/COD, search, paging) and a **pipeline-transition bug fixed** (order detail read `toTransitions`/incoming instead of `fromTransitions`/outgoing, so the entry stage showed "No further actions"). **Redundant surfaces removed**: the ecommerce **Coupons** + **Categories** tabs/pages/APIs and the legacy `ShopCoupon` model are gone — promotions live in Customer Retention (unified `Coupon`), categories in Inventory masters; E-Commerce is now **Dashboard · Orders · Products** (sidebar updated to match). See [docs/modules/sales.md](docs/modules/sales.md). _Deferred:_ payment gateways, stock reservation, auto-invoice, server-side cart/address book.
- **2026-06-05 — Deals pipeline + CRM-grade Contacts list**: (a) the HubSpot-style deal pipeline (kanban board + activity timeline, position-owned, JSON-actor) was **renamed CRM → Deals** — model `CrmLead`/`CrmLeadActivity` → `Deal`/`DealActivity`, permissions `crm:* → deals:*`, routes `/office/crm/deals` + `/api/deals`, module `src/modules/deals`, seeded **P6** pipeline relabelled `name:"deals"`/`label:"Deals"`. The actor-snapshot helper lives in `src/shared/lib/auth/actorSnapshot.ts` (shared by Deals + the work board; `taskActor.ts` delegates). New [docs/modules/deals.md](docs/modules/deals.md). (b) **Customers relabelled "Contacts"** and given big-list tooling: `Person`/`Company` gained `lifecycleStage` (`ContactLifecycle` LEAD/PROSPECT/CUSTOMER/INACTIVE), `ownerPositionId` (seat owner, holder resolved live), and `tags String[]`. New paginated/filterable `GET /api/contacts` (People; q/lifecycle/owner/tag/hasDeal/sort via `parsePagination`) + `POST /api/contacts/bulk` (set lifecycle / assign owner / add·remove tag / activate·deactivate). New `ContactsWorkspace` at `/office/customers` (paged table via `PaginationBar`, filter bar, multi-select **bulk bar**, **CSV export** with BOM). `dummy-customers.ts` now seeds 250 synthetic contacts with a lifecycle/tag spread so the list demonstrates scale. **Deals stay linked to a contact** via `personId`/`companyId` (a contact's deals are queryable via `/api/deals?personId=`). Won links a customer; it does not auto-create a sale (protected sales flow untouched). _Deferred:_ a Deals tab on the contact detail pages and import field-map extension (lifecycle/owner/tags on CSV import). New [docs/modules/contacts.md](docs/modules/contacts.md).
- **2026-06-05 — Administration work board (pipeline-based internal todos, position-owned)**: new device-free `Task` + `TaskComment` models (`prisma/schema/task.prisma`) that ride the shared `Pipeline`/`TicketStatus` tables on the seeded **P4 "internal-management"** pipeline (Open → In Review → In Progress → On Hold → Done) — repair `Ticket` was unusable (required `deviceId`, warranty/billing baggage). **Ownership is a Position (seat), not a user**: `Task.assignedPositionId` → `Position`, and the effective owner is resolved live from `UserPosition.holders`, so open work transfers automatically when staff resign or change branch (matches the position-based RBAC). **No User FKs** — the actor of an action is a frozen JSON snapshot (`Task.createdBy` / `TaskComment.author`, shape `TaskActor`, built by `buildTaskActor`), so audit history survives staff turnover. Kanban **Work Board** at `/office/administration` (native HTML5 drag-and-drop with priority left-accent cards showing position + current holder; optimistic stage moves; "My tasks" = held-position filter; create/edit dialogs with an assign-to-position picker; per-task activity thread mixing user `COMMENT`s and auto `SYSTEM` change-logs; terminal stage stamps `completedAt`). Server layout adds a `PathBreadcrumb` + Esc-back; the sidebar section carries a button-bar **"New Task +"** deep-link (`?new=1`). `/api/admin-tasks` CRUD + `/[id]/comments`; new `administration:tasks:view|manage` permissions (R1 auto, R5 granted) gating the API, page layout, and sidebar section. `dummy-tasks.ts` seed (6 demo tasks on positions, in `seed:dummy-all`); `Task`/`TaskComment` added to `hard-clean` `TRANSACTION_TABLES`. DRY by design — other modules can adopt `Task` later. See [docs/modules/administration.md](docs/modules/administration.md).
- **2026-06-04 — Per-product additive point (`PRODUCT` strategy dimension)**: the additive-margin engine gained a per-SKU override. New `PRODUCT` value on the `StrategyPointDimension` enum (keyed by product id); `margin% = base + brand + category + group + product`. It is *added* to the master sum (negative discounts a poor performer even when its brand/category/group all add positive points; positive lifts a star SKU under weak masters), so unlike `marginPercent`/manual-price it keeps the SKU following future brand/category/group changes. Edited inline via a new **`Product pts`** column on the `/office/pricing-strategy/strategies` preview table, which is now paged by a new reusable **`PaginationBar`** (`src/shared/components/PaginationBar.tsx`) replacing the old silent 300-row cap. Engine (`additiveMargin.ts`), `strategyPointsSaveSchema`, and the `points` GET/PUT route all carry the `product` map; the `items`/`apply`/`recomputePrices` callers needed no change. No seed change. See [docs/modules/pricing-strategy.md](docs/modules/pricing-strategy.md).
- **2026-06-03 — Additional-cost (shipping/courier) allocation layer**: a decision-support layer that attributes already-booked courier expense to products as a per-unit cost for **pricing & margin only — it never posts to the GL** (accountancy stays untouched, the owner's hard constraint). Nominate an `AccountGroup` as the pool (`OrgDefaults.shippingPoolGroupId`); every POSTED debit to a ledger under it is a waiting "entry". New `/office/pricing-strategy/costing` page: per entry, **Allocate** the product-freight share — voucher-driven (`AllocateVoucherDialog` + `costing/draws/batch`): pick the PURCHASE/GRN voucher and spread freight across its product lines via per-unit inputs (by-value / by-qty auto-distribute) — and/or **Dismiss** the office-courier remainder so it leaves the waiting list (one courier bill often covers both). Draw history is inline-editable. New `AdditionalCostAllocation` model (`additional_cost_allocations`, kind `ALLOCATION|DISMISSAL`, rows against a `JournalLine` debit + `sourceInvVoucherId`) + `AdditionalCostAllocationKind` enum + `costPool.ts` (LAST-allocation derive rule) + `costing/pool` & `costing/draws`(+`[id]` DELETE) APIs. `items` API now exposes per-unit `additionalCostPaise` (separate from the pristine `resolvedCostPaise`); `additiveMargin.ts` `additivePriceWithSurcharge` folds it in **before** GST; Items + Update & Print Labels reflect it in Computed/Profit. Pool-group selector on the Org Defaults settings form. Dummy demo in `dummy-vouchers.ts`. **Sale/POS margin display deferred** (protected surface). See [docs/modules/pricing-strategy.md](docs/modules/pricing-strategy.md).
- **2026-06-03 — Per-customer credit limit edit UI**: `Account.creditLimit` is no longer dormant — `PATCH /api/accounts/[id]` now writes it (gated by `customers:edit:org` for a person ledger, `companies:edit:org` for a company), and a new `AccountCreditLimitCard` ([src/modules/customer/components](src/modules/customer/components/AccountCreditLimitCard.tsx)) sits on both the Person and Company **Profile** tabs. `GET /api/person/[id]` and `GET /api/companies/[id]` now pass `creditLimit` through. Deny-by-default semantics preserved (blank/0 = cash-only, positive = credit headroom); enforcement at sale time via `checkCreditLimit` is unchanged. See [docs/modules/people.md](docs/modules/people.md).
- **2026-06-01 — Loyalty v1 (POS earn + redeem wallet)**: new `loyalty.prisma` (config singleton + per category/group/product earn-rule multipliers + per-customer account + lots + audit ledger), `src/modules/loyalty/{lib,components}`, and five `/api/loyalty/*` routes. Identified customers earn points on POS sales (rate resolves product→group→category→global) and redeem them as a bill discount. **Expiry is dynamic + lazy** (no cron): a lot is valid iff `earnedAt > now − expiryDays`, computed live — raising the window revives recently-lapsed points, lowering it drops them; balance is never cached. Config matches+beats Vyapar's reward screen (min-invoice-to-earn, min-invoice-to-redeem, expiry on/off in days, min-points). **Earning is GL-silent**; **redemption** posts to a seeded **"Loyalty Points Redeemed"** expense ledger via a negative `InvVoucherCharge` (the protected `postInvVoucherToGl` math is reused unchanged); outstanding points are shown as a read-only **memo liability** (not booked). Admin hub at `/office/customer-retention/loyalty` + a Loyalty tab on the customer profile. New permission `loyalty:manage`. Also **fixed a latent POS bug**: the tier discount was computed client-side but never sent, so any tier > 0% failed the server payment-total check — `/api/pos/sale` now accepts `discountAmt` (→ Discount Allowed). v1 is POS-only; low-margin protection is manual (set loss-makers to 0×). See [docs/modules/loyalty.md](docs/modules/loyalty.md).
- **2026-05-21 — GL engine reference split**: every `JournalEntry` auto-created by the posting engine (Sale, Purchase, POS, Receipt, Payment, Contra, user JV, returns, shift variance, e-commerce JE, reversal JE) now uses a new `GL_POSTING` VoucherSeries with reference prefix `GL-…` (was `JE-…`, which visually collided with the user's Journal Voucher). The user Journal Voucher series locks to `JV-…`. `GET /api/accountancy/journal-entries` hides engine output by default (`?includeEngine=1` to inspect); `POST /api/accountancy/journal-entries` is deprecated and returns 410 — all user journals go through `/api/accountancy/journal-vouchers`. Day Book duplicates (one row per sale + a second "JOURNAL" row) are gone. Voucher/InvVoucher table split kept intentionally — see [accountancy.md](docs/modules/accountancy.md) "Two engines" + "Why two voucher tables" sections.
- **2026-05-20 — Admin + Settings V1.5 (in-section nav)**: `office/admin/layout.tsx` + `AdminNav` and `office/settings/layout.tsx` + `SettingsNav` — permission-filtered grouped tab bars (same pattern as voucher registers), sourced from `ADMIN_NAV` / `SETTINGS_NAV` in `constants.ts`. Admin `loading.tsx` skeleton keeps nav visible while page content loads.
- **2026-05-20 — Settings module extracted from Admin**: 7 pages (pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings) + `OrgDefaultsForm` moved to `/office/settings/*` and `src/modules/settings/`. New [docs/modules/settings.md](docs/modules/settings.md). Hard cut, no compat redirects from old `/office/admin/<page>` URLs. `next.config.ts` cleaned up to avoid hijacking the new `/office/settings/*` paths.
- **2026-05-19 — Admin module V1**: branches/departments/posts/org-chart terminology cleanup, ID labels, dummy-org seeding. Commits `bb4dfd3`, `2d3f455`, `03826b2`, `e4ae844`.
- **2026-05-18 — Auth + welcome**: `BranchRequired` gate, welcome page; removed thermal-relay tools. `71e5c67`.
- **2026-05-18 — Voucher top-bar / action-bar**: `VoucherTopBar`, `VoucherActionBar`, `VoucherInlineActions` wired across inventory + finance voucher pages. `93576f2`, `9bfe84c`.
- **2026-05-18 — Branch Transfer voucher + Manufacturing Journals + Physical Stock**. `eb13618`, `eff0356`.
- **2026-05-18 — Bill of Materials (BOM)** in inventory + new voucher types. `28a91fe`.
- **2026-05-17 — Day Book V1**: presets, expanded rows, persisted filters, breadcrumb nav, draft/cancelled status beside type. Multiple commits in `bafd709`–`16a1e48`.
- **2026-05-17 — Voucher registers**: shared `VoucherRegisterTable` + `voucherUrls`, duplicate-handoff flow, Pending Vouchers report, editable GL voucher pages, UTC date bug fix. `5cac4b1`, `ca6c966`, `bafd709`, `396f4d5`.
- **2026-05-16 — Tax Classification report** (`/office/accountancy/reports/gst/classification`) with four tabs. `649781d`.
- **2026-05-16 — Inventory GST/HSN cascade**: product → group chain → org default → null. `44d5327`.

For the milestone log (M1–M26) prior to 2026-05-14, read `git log` or earlier revisions of this file.

---

## 📋 Next up (prioritised)

0. **Order-to-Cash (O2C) redesign — agreed 2026-06-07; Phase 1 SHIPPED.** Full design in [docs/srs/order-to-cash.md](docs/srs/order-to-cash.md), summary in the **🧭 Design: Order-to-Cash** section below. Headline: one **Order backbone** fed by all channels (counter/phone/online/B2B as adapters); **counter Sale = always hand-to-hand**, deferred cases are Orders identical to phone orders; **POS mode-first** (Sale/Order/Estimate on separate pages, frozen POS untouched); **parent Order pipeline + child pipelines** (Delivery/Recovery/Return); **lazy GL ledgers** (account on first transaction); **3-tier lead funnel** (RawLead→Contact→Customer); pluggable **carrier abstraction** (Shiprocket/own-boy/pickup) with rate-shopping. Accountancy engine reused unchanged. **Phase 1 (POS Estimate mode) shipped 2026-06-07** — see Recently shipped. **Next phases:** 2 = stock **reservation** layer (on-hand/reserved/available, per branch); 3 = extract **Order** out of Ecommerce into its own backbone module + POS **Order mode**; 4 = lazy ledger + lead→customer promotion; 5 = **Delivery module + Rate Engine** (own-boy/manual first); 6 = Recovery / Return&Refund pipelines.
1. **Doc consistency sweep** — keep this file as the only source of status; resist re-adding "shipped" markers to module docs.
2. **`/lab` decision** — promote to a real `/office` module, fold into existing nav, or delete. It currently lives undefined.
3. **Universal Customer Finder** — build the multi-signal Front Office search: narrow to a customer by **any** clue — name / phone / email / address (✅ done) + product **bought / repaired / inquired / ordered online** + **month / last-active**. Move from client-side merge to one server-side `/api/customers/find` endpoint. Phased; next concrete step is **Phase B — products bought**. Full design, signal inventory, endpoint sketch, and gotchas in the **🧭 Design: Universal Customer Finder** section below.

---

## 🧭 Design: Universal Customer Finder (planned — 2026-06-05)

**Goal.** On `/lab/front`, identify *which* customer staff mean from **any** shred of evidence — name, phone, email, address, a product they **bought / repaired / inquired about / ordered online**, or **when** they were active (a month / "last active"). Each clue narrows the list; every match shows *why* (evidence chip).

**Current state (shipped).**
- Identity: **name + phone** (`/api/person?lookup=`), and **email + address** via opt-in `wide=1` (2026-06-05). `wide` is opt-in so POS/QuickTicket/party pickers keep strict name+phone search.
- Repairs: **device brand/model/type + problem text** — `/api/tickets` is loaded **once into the browser** and filtered client-side.
- Scoring lives in `src/modules/lab/lib/buildCandidates.ts` (pure, framework-free): merges people-hits + tickets by `accountId`, scores by *how many distinct query terms have evidence*, emits typed `EvidenceTag`s rendered by `CandidateRow.tsx`.

**Architecture decision.** The "load all rows into the browser and filter" trick works for 2 sources but will **not** scale to sales + leads + shop orders + date filtering. Move to **one server-side finder endpoint**; `buildCandidates` was written pure specifically so its merge/score logic can migrate server-side unchanged.

```
GET /api/customers/find?q=rosy+laptop&month=2026-05&group=Sundry+Debtors
  → parallel server-side searches, each capped + term-filtered:
      identity   name/phone/email/address        (Person, Company, Phone, Email)
      repairs    device brand/model/problem       (Ticket → Device.accountId)
      sales      product bought                    (InvVoucherLine → InvVoucher.accountId, type SALE/POS)
      inquiries  interest/title/notes              (CrmLead → personId/companyId)
      shop       online order items                (ShopOrderLine → ShopOrder.accountId|personId)
  → merge by Account.id, score by terms-covered, optional date-window filter
  → ranked candidates + typed evidence ("Bought: Asus laptop · May 2026")
```

**Signal inventory** (link path → customer · when):
| Signal | Model (file) | Link to customer | When |
|---|---|---|---|
| Identity | `Person`/`Company`/`Phone`/`Email` (base.prisma) | self / `personId`/`companyId` → `Account` | `createdAt` |
| Repairs | `Ticket`/`Device` (tickets.prisma) | `Device.accountId` | `Ticket.createdAt`, `receivedBackAt` |
| Sales/POS/Estimate/Return | `InvVoucher`/`InvVoucherLine` (inventory.prisma) | `InvVoucher.accountId` | `InvVoucher.date` *(DB `date`, not DateTime)* |
| Inquiries | `CrmLead` (crm.prisma) | `personId`/`companyId` | `createdAt`, `updatedAt` |
| Online orders | `ShopOrder`/`ShopOrderLine` (shop.prisma) | `accountId` *or legacy* `personId` | `createdAt`, `paidAt`, `deliveredAt` |
| Payments/receipts | `Voucher` (finance.prisma) | `partyAccountId` | `date` — low ID value; narration only |
| Loyalty / coupons / gift cards | loyalty.prisma, coupons.prisma | `accountId` / `ownerAccountId` | various — low ID value; skip for finder |

**Phased roadmap.**
- **A — DONE (2026-06-05):** email + address matching (opt-in `wide=1`), new `email`/`address` evidence tags + chips.
- **B — Products bought:** sales-history matching. New `{ kind: "purchase" }` evidence tag (product name · date). Smallest standalone step; can be a `/api/customers/find` v0 scoped to sales only, OR a temporary `/api/inventory/products/sold-by` lookup.
- **C — Inquiries + online orders:** fold `CrmLead` (interest/title/notes) and `ShopOrderLine` (online purchases) into the finder. New `{ kind: "inquiry" }` / `{ kind: "order" }` tags.
- **D — Time / "when":** month + last-active dimension. UX: a dedicated **month/date chip** (not a free-text token — "may" is ambiguous as a word) that filters every signal's date window; also sort candidates by *latest activity*. Surface "Last active: May 2026" on each row.
- **E — Scale:** if volume warrants, a denormalized `CustomerActivityLog(accountId, signalType, signalId, date, summaryText, productSku)` (materialized view or sync job) so the finder is one indexed query instead of N parallel ones. Harmonize `InvVoucher.date` → indexed `DateTime` for range queries.

**Gotchas to honor when building.**
- Keep POS/party-picker search **strict** — only the finder opts into wide/multi-signal.
- `InvVoucher.date` is a DB `date`, not `DateTime` — month-range filtering must account for that.
- Never surface raw `GL-…` refs; resolve purchase evidence to the originating voucher number.
- Branch scoping is not yet enforced on ticket/sale/customer queries (see item 6) — the finder should be ready to filter by `branchId` once that lands.
- Sources to reference when implementing: `buildCandidates.ts`, `CandidateRow.tsx`, `usePartySearch.ts`, `/api/person/route.ts` (the `wide` pattern), `/api/inventory/vouchers`, `/api/tickets`, `/api/crm/leads`, `/api/shop/orders`.
3. **POS follow-ups**: return receipt print page (`/receipt/return/[id]`); multi-partial-return guard (subtract prior returns from per-line cap); stuck-shift auto-close cron; per-row bank account picker for UPI/Card.
4. **Outstandings — Pay Now / Receive Now action** — on `/office/accountancy/reports/ledger-outstandings/[id]` (and the Receivables/Payables bill-wise tabs), add a per-row "Receive Now" (debtors) / "Pay Now" (creditors) button that opens a pre-filled Receipt/Payment voucher with the bill auto-allocated. Saves the user from copy-pasting the bill ref + amount into a blank voucher.
5. **Repair-side reporting** — tickets by status/pipeline, avg resolution, technician workload. Finance side is covered; repair side is bare.
6. **Branch-scoped data filtering** — permissions exist but ticket/customer/invoice queries don't filter by `branchId`.
7. **Ticket list pagination** — current list loads all rows.
8. **Accountancy Phase 5b** — GSTR-1/3B export, e-Invoice (IRN) integration, RCM on purchases.
9. **Portal ticket detail** — full notes + status history, not just the list.
10. **Stock decrement on shop order confirm** — now possible since `InvProduct` is unified and multi-branch stock is live.
11. **Razorpay payment status page** — post-payment redirect with real-time polling.
12. **`/api/finance/*` → `/api/accountancy/*`** rename (still deferred from the 2026-05-07 module rename).
13. **Credit-limit enforcement on the office Sale voucher** — credit is now deny-by-default (NULL/0 = no credit; only a positive limit permits credit), but `checkCreditLimit` is wired **only** into the POS sale path. The office Sale voucher (`/api/inventory/vouchers`, SALE) still creates credit sales with no check, bypassing the limit. Add `checkCreditLimit(tx, accountId, onCredit)` inside that route's transaction (mirrors `src/app/api/pos/sale/route.ts:226`). Note: this is a behaviour change to a protected accountancy surface — it will start *blocking* office credit sales that exceed the limit, so confirm before shipping.
13. **Schema migration hygiene** — GST/HSN + naming-convention columns were added via `db push`, no migration. Needs a proper migration before any prod deploy.
14. **Franchisee support** — model independent shops that use your brand but are separate legal entities (own PAN, own GSTIN). Distinct from company-owned `Branch` (same legal entity, your stock, your cash, your books) on every dimension that matters: a franchisee is a `Company` row under Sundry Debtors, sales to them are real B2B vouchers (IGST / CGST+SGST per state), their end-customer sales never enter your books, and royalty is a separate ledger. Smallest first step: add `isFranchisee Boolean @default(false)` + `royaltyPercent Decimal?` + `franchiseStartedAt DateTime?` on `Company`; surface a "Franchisee" filter / badge in customer lists; partner-portal access (one login per franchisee proprietor) reusing existing customer-portal infra. Bigger follow-ups: monthly royalty invoice generation, stock advisory dashboards, contract documents. See chat 2026-05-23 for the full company-owned-vs-franchisee comparison.
15. **Loyalty points** — earn/redeem points on POS + shop sales; per-customer balance, configurable accrual rate, redemption as discount or store credit; ledger-backed so liability shows on the books.
16. **Long-term**: SLA alerts; B2B Company portal; ERP module foundation; per-customer pricing tiers; credit-limit enforcement.

---

## 🧭 Design: Order-to-Cash (O2C) — agreed 2026-06-07

Full spec: [docs/srs/order-to-cash.md](docs/srs/order-to-cash.md). Summary waterfall:

```
RAW LEAD (staging) ─qualify→ CONTACT (LEAD, no ledger) ─signal→ DEAL (P6) ─convert→
  ORDER (P7 parent, reserves stock, NO GL) ─invoice→ SALE (GL + stock-out; Account created, →CUSTOMER)
    ├─ DELIVERY pipeline (carriers: Shiprocket/DTDC/own-boy/pickup; rate-shop→book→track)
    ├─ RECOVERY pipeline (post-invoice dues)   (TODO)
    └─ RETURN & REFUND pipeline                (TODO)
  → "happy" (delivered + settled)
```

**Locked decisions:** (1) one Order backbone, channels are adapters; (2) counter Sale = always
hand-to-hand, deferred = Order identical to phone order; (3) POS mode-first (Sale/Order/Estimate,
separate pages, frozen POS untouched); (4) parent Order + child pipelines on the shared engine;
(5) Order/Estimate GL-silent — only Sale + Recovery touch GL; (6) lazy ledgers (Account at first
txn); (7) advances ride the customer account, netted at invoice; (8) 3-tier lead funnel keeps the
hot `Person` table clean; (9) carriers pluggable, own-boy is a manual carrier, don't double-
integrate what Shiprocket aggregates. **Build pending** — see Next-up item 0.

## 🧠 Key decisions

| Area | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | Server + client co-location; Turbopack for dev speed. |
| ORM | Prisma split schema | One datasource, modular schema files. |
| Auth | NextAuth v5 JWT, two providers | Staff and portal credentials never crossover; `CustomerPortalCredential` is a separate table. |
| State | Zustand + localStorage for client carts | No server round-trip until checkout. |
| Money | Integer paise everywhere | Avoid float drift; format with `moneyInr.ts`. |
| Accounting model | `AccountType → AccountGroup → Ledger` | Tally mental model in code, normalised in DB. |
| Suspense ledger | Auto-route opening-balance mismatches | Trial balance always balances during legacy imports. |
| Inventory unification | Single `InvProduct` for shop + warehouse + POS | No sync layer between catalog and stock. |
| POS tills | Counter-based, not user-based | Any cashier can work any counter; variance lands on the counter account. |
| Pipelines | Generic engine reused for Tickets and CRM Leads | Don't dual-write; leads are device-less tickets. |

---

## 💡 Ideas (parking lot)

- Pipeline-specific dashboards per pipeline (Repair / Sales / etc.).
- B2B Company portal — companies see all linked devices/tickets.
- Despatch courier integration — auto-generate tracking label from "Pending Despatch" sub-status.
- SLA alerts — flag tickets stuck too long in a status.
- Position model — named slots in the org chart (needed at 50+ users).
- Per-branch reorder points on `InvProductBranch` (currently global on `InvProduct`).
- GSTIN auto-fill from public GST lookup API when typing a 15-char GSTIN.
- POS exchange as one atomic transaction (currently credit note → new sale).
- Personal till accountability via a user dimension on variance JEs (currently counter-only).

---

## ⚠️ Known gotchas

- **Server restart required after `prisma generate`.** Turbopack caches Prisma client chunks.
- **Middleware is `src/proxy.ts`, NOT `middleware.ts`.** Next.js 16 rename.
- **Split Prisma schema** — `prisma/schema/*.prisma`, configured in `prisma.config.ts`.
- **NextAuth v5 beta** — cast `session.user` for `id`/`role`/`roles`/`permissions`. Never use `getToken()`.
- **Scalar list filtering** — `String[]` uses `{ has: "R3" }` (Postgres only).
- **Sub-status `allowedRoles`** — R1 always bypasses, by design.
- **Opaque IDs** — S1–S10 statuses, SS1–SS37 sub-statuses, R1–R4 roles, P1–P4 priorities, `P-REPAIR` / `P-SALES` pipelines.
- **`@@unique` with nullable fields** — Postgres treats NULL as distinct; `skipDuplicates` is unreliable. Use `findFirst` + `create`.
- **Razorpay** — `RAZORPAY_WEBHOOK_SECRET` must be set in `.env`, otherwise webhooks reject silently.
- **Portal and staff auth never crossover.** Don't reuse staff cookies for portal.
- **Shop prices in paise.** Use `moneyInr.ts` to format. Never divide by 100 inline.
- **Schema added via `db push`, no migration**: GST/HSN columns, naming-convention columns. Migrate before any prod deploy.
- **Legacy `src/modules/tally/`** co-exists with `src/modules/accountancy/`. Rename was 2026-05-07; folder removal is pending separate work.

---

## 🔗 External resources

- Supabase: `aws-1-ap-south-1.pooler.supabase.com`.
- Next.js 16 docs: `node_modules/next/dist/docs/`.
- NextAuth v5 docs: https://authjs.dev/.
