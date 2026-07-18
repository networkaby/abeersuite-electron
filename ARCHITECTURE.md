# Architecture Overview

Current implementation of `service-mgmt-experiment` — an internal business OS for a multi-channel computer & CCTV shop (retail in-store + online, wholesale, and a repair service centre) on one shared inventory + accounting backbone.

**Present-tense only.** This file describes what the code is *now*. Status, plans, decisions, and history live in [PROJECT_BRAIN.md](PROJECT_BRAIN.md); setup in [README.md](README.md); contributor rules in [AGENTS.md](AGENTS.md); authoritative history in `git log`.

> ⚠️ This file lists only what the code has **now**. If a model or rule you remember isn't described here, treat it as **not existing** — do not rebuild it against an older design.

---

## 1) Runtime

- **Framework** — Next.js 16 App Router (`src/app`), React 19, Turbopack dev.
- **Middleware** — `src/proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`; do **not** create `middleware.ts`).
- **API** — route handlers under `src/app/api/*`.
- **Data** — Prisma 7 (split schema) + PostgreSQL (Supabase). Client singleton in `src/shared/lib/prisma/`.
- **Auth** — NextAuth v5 (JWT strategy), two independent credential providers (staff + portal).
- **Money** — integer paise everywhere; format via `src/shared/lib/format/moneyInr.ts`. Round to 2dp once, at the ledger writer boundary (`round2`).

---

## 2) Domain modules (`src/modules/`)

`accountancy` · `inventory` · `pos` · `pricing-strategy` · `coupons` · `loyalty` — the commerce + finance core.
`repairing` · `deals` · `order` · `delivery` · `refund` — the pipeline/ticket flavours.
`customer` (contacts) · `admin` · `administration` · `settings` · `home` · `message` · `core` — org, contacts, workspace.
`ecommerce` (staff shop admin) · `external` (customer-facing shop/store/portal UI) · `lab` (throwaway prototype, not production).

Cross-cutting code lives in `src/shared/` (see §12). shadcn primitives live in `src/components/ui/`. Accepted legacy homes (leave in place): `src/utils/`, `src/store/`, `src/components/ui/`.

---

## 3) Route groups (`src/app`)

- **`(protected)/office/*`** — staff app (requires a staff session). Segments mirror URLs 1:1: `accountancy`, `inventory`, `pos` (manager shift reports), `pricing-strategy`, `customer-retention`, `customers` (Contacts), `crm`, `orders`, `repairing`, `ecommerce`, `admin`, `administration`, `settings`, `work-flow-inbox` (post-login landing).
- **`(protected)/vouchers/pos`** — the POS register (operator surface), opened standalone. `/vouchers/pos/new` is the New Sale screen.
- **`(external)/*`** — customer-facing: `(store)` marketing homepage, `shop` (catalogue → cart → Razorpay checkout), `portal` (customer self-service), `login` (portal sign-in).
- **`(protected)/lab`** — experimental Front/Back-office prototype. Not gated, not production.
- Staff sign-in: `/staff/login`. Portal sign-in: `/login`.

---

## 4) Authorization — the three-axis model

Authorization is **liberal by default**. A restriction must be one of three things sourced from the **position** (the appointment), never stapled to the person; a person = a union over their positions.

- **Axis 1 — UI / visibility.** `ui:sidebar:<module>:<link>` grants decide which nav links a role sees, at full nav depth (generated from the constants nav tree via `src/shared/lib/auth/sidebarModules.ts`). This is the **only** thing that hides pages/tabs. The office manager POS module is `ui:sidebar:pos:*`; the operator's register link is `ui:sidebar:workspace:pos` — **they are different grants** (see §8).
- **Axis 2 — Action.** Two sub-flavours defaulting in opposite directions:
  - **Reads default OPEN.** GET data routes and page/layout/nav views take only `requireAuth` (any signed-in staff). No hidden capability gate blocks a read.
  - **Writes default DENIED.** A write gates on the matching role-page permission — `requirePermission` / per-kind voucher keys (`finance:voucher:<action>:<kind>`, `inventory:voucher:<action>:<kind>`), and `requirePosVoucher` (the `pos:voucher:create:<kind>` tick) for POS create routes.
- **Axis 3 — Radius.** Data visibility is the position's branch set (`where.branchId in branchIds`), lifted only by an all-branch grant. Contacts (Person/Company) carry no branch, so no radius applies to them. This replaces the old `:own/:branch/:org` scope suffix.

Guard helpers live in `src/shared/lib/auth/` (`requireAuth`, `requirePermission`, `requireVoucherPermission`, `requirePosVoucher`, `requirePortalAuth`). Direction is permission-driven, never role-name checks.

**Department permission pool** (`DepartmentPermission` / `Department.isAllAccess`) is an **authoring-time lens only** — it bounds which permissions a role *may be granted* in the Role editor; it never runs at request time (runtime resolves position → role → grants). See `departmentPool.ts`.

Sessions revoke instantly on grant changes: mutating routes bump `tokensValidFrom` (`revokeSessions.ts`) so affected users re-log with fresh JWTs.

---

## 5) Accounting & the Transaction Engine

There is **one** general-ledger representation: the **`UniversalVoucher` spine** + its GL lines. Every voucher kind — GL (payment/receipt/contra/credit-note/debit-note/journal) and inventory (sale/purchase/POS/estimate/order/GRN/challan/…) — is a single `UniversalVoucher` row.

- **`UniversalVoucher`** (`finance.prisma`) — the header/anchor: `type` (spans all kinds), `status`, `binding` (`REGULAR` = real transaction with GL/stock, `OPTIONAL` = non-binding document like estimate/order), `date`, `branchId`, `partyAccountId`, `voucherNo` (per-kind series number), creator. The global number is the row `id` (`UV-<id>` via `formatUvNo`).
- **`VoucherGlLine`** — the Dr/Cr postings, each tagged by `VoucherGlRole` (body / tax / tender / charge / round-off). Tender legs (cash/bank/AR) are GL lines, not a separate table.
- **`VoucherDetail`** (`inventory.prisma`) — a 1:1 sidecar holding only cosmetic/print fields (frozen party JSON, GST/place-of-supply, printed totals, settlement JSON, return links). *(This is the model formerly named `InvVoucher`.)*
- **`VoucherInventoryLine`** + **`InvStockLedger`** — the goods lines and stock movements. The mere existence of inventory lines ⇒ it's an inventory voucher (no discriminator).
- **`VoucherLink`** — loose, FK-free workflow links (ticket/deal/order/shop-order) so the ledger stays decoupled from the disposable workflow.
- **`VoucherAllocation`** — settlement links (receipt → the bills it clears; advance → against-ref).

**The Transaction Engine** (`src/modules/accountancy/lib/transactionEngine.ts`) is the single internal ledger writer. A posting voucher funnels through **`enginePost(spec)`**, which drives two arms inside the *caller's* transaction (atomic; the engine never opens its own tx):

- **`engineGlArm`** — writes the balanced `VoucherGlLine` set + `Account.balance` deltas.
- **`engineStockArm`** — writes `InvStockLedger` + `InvProduct`/`InvProductBranch` stock caches.

`engineCreateSpine` mints the draft header up front (document anchor) so goods lines hang off it before posting. Closing stock / COGS is **not** posted per voucher — it's computed live at report time (Tally-style). Opening-balance mismatches route to a system **Suspense** ledger so the trial balance always balances.

**The `Account` is the bridge.** Party ledgers (`accounts.prisma`: `AccountGroup` → `Account`) are the one durable link between the protected accounting core and the disposable workflow. The GL posting path, balances, and reports (BS / P&L / Day Book / Trial Balance) are a **protected surface** — verify with the parity harness and confirm before changing the math (see PROJECT_BRAIN.md).

---

## 6) Inventory

- **`InvProduct`** is the single source of truth for storefront + warehouse + POS (carries `hsnCode`, `gstRate`, `taxability`, `attrsJson`, naming config). No separate shop product.
- Masters: `InvUnit`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvWarrantyTerm`, `InvAttributeMaster`, `GstRate`, `InvBom`/`InvBomLine`.
- Stock: `InvProductBranch` (per-branch stock), `InvStockLedger` (movements), `StockReservation` / `RedemptionHold` (soft holds).
- Pricing: `pricing-strategy` module + `StrategyPoint`; costing via `AdditionalCostAllocation`.

---

## 7) POS

- Tills are **counter-based, not user-based** — any cashier works any counter; variance lands on the counter account, and human accountability comes from the shift report.
- Models (`pos.prisma`): `PosCounter` (+ `PosCounterPaymentAccount`, `PaymentGateway`), `PosShift` (`OPEN → AWAITING_HANDOVER → CLOSED`), `PosCashDrop`, `PosExpenditure`, `PosReceipt`, `PosHandover`.
- A sale requires an **OPEN shift on a counter** — the create route returns `NO_OPEN_SHIFT` otherwise. Branch context comes from the shift, not the session cookie (parallel billing from many browsers).
- POS create routes gate on **`requirePosVoucher`** (the `pos:voucher:create:<kind>` tick), because a counter operator holds `ui:sidebar:workspace:pos`, not the office `ui:sidebar:pos:*` module.
- A POS sale is a `UniversalVoucher` (`type=POS`) with tender/charge GL lines, stock movement, GST routing, and optional loyalty/coupon/gift-card effects — one balanced posting via `enginePost`.

---

## 8) Workflow — pipelines, tickets & the work engine

The pipeline engine models a **journey**, three levels deep: `Pipeline` → `TicketStatus` (stages) → `TicketWorker` (sub-statuses inside a stage). One **`Ticket`** core row rides every pipeline; `Pipeline.entityType` (`repair` | `deal` | `order` | `delivery` | `refund` | `task` | `none`) selects the optional 1:1 detail table — `TicketRepair`, `TicketDeal`, `TicketOrder`/`TicketOrderLine`, `TicketDelivery`, `TicketRefund` (`task`/`none` = a bare core row). Cross-pipeline transfer is just an `update { pipelineId, status }` on the core row; the detail row stays attached as history.

`TicketLog` is the single timeline (actor is a frozen JSON snapshot, not a User FK). `Device` + `ServiceCenter` support repair. Ownership = `createdBy` snapshot; assignment = `assignedPositionId` seat; `TicketParticipant` adds helpers. The **Work Inbox** (`/work-flow-inbox`, the post-login landing) lists tickets group-wise for the operator.

**The sub-status carries the automation.** A `TicketWorker` completes through `/api/tickets/[id]/worker`, driving:

- **Work units.** A `Work` (categorised by `WorkGroup`) is the unit of work a status/sub-status represents (calling, parts, QC). The Work owns the completion *vocabulary* (success/fail labels, popups, args); the worker owns the *wiring*. `Work.kind` is `"human"` (completed on the Work Inbox) or `"auto"` (a hardcoded tool runs it — `actionTools.ts` / `toolRegistry.ts`). A gated `Work` / `WorkGroup` mints a `work:<id>` / `workgroup:<id>` permission (act-on vs see-in-inbox).
- **Outcome routing.** Success/unsuccess routes to `successWorkerId`/`failWorkerId` (same stage) or `successStatusId`/`failStatusId` (jump straight to another stage, applying its entry worker).
- **Retry schedule.** A waiting worker (Unreachable, Awaiting-parts) re-arms on a front-loaded `retrySchedule`, setting `wakeAt` and dropping into the Work Inbox "Waiting" tab until due.
- **Child spawn ("5th power").** A sub-status with `spawnPipelineId` spawns a CHILD ticket on another pipeline; the child reports back through `parentSignal` (`spawnChild.ts`, `reconcileParentFromChild`).
- **Actions ("6th power").** An ordered, outcome-filtered list of hooks (`spawn | move_status | email | retry | …`) fires on completion — `runWorkerActions` (`actions.ts`), with `autoAdvance` for chained auto-works.

Repair, deals, delivery, and refund all ride this one engine. **The `Account` is the only bridge into accountancy** — `Ticket.accountId` links to a party ledger; no voucher/GL FK points *into* workflow (`VoucherLink` stays loose and FK-free, §5).

---

## 9) Contacts & parties

- **`Person`**, **`Company`**, **`PersonCompany`** (join), with `Phone` / `Email` and a `ContactLifecycle` (`base.prisma`). *(These replaced the old `Customer` / `CustomerCompany`.)*
- GST identity (GSTIN, state code, reg type) lives on `Person` / `Company`, not a separate party model.
- Contacts are a **flat** permission surface: `customers:{view,create,edit,delete}`, any branch (no radius — contacts have no branch).
- The accounting-facing party is the **`Account`** (party ledger); a Person/Company links to its `Account`.

---

## 10) Adjacent domains

- **Loyalty** (`loyalty.prisma`) — points earn/redeem with expiry lots (`LoyaltyLot`/`LoyaltyLedger`), tiers, milestones; applied inside the POS sale tx.
- **Coupons / gift cards** (`coupons.prisma`) — `Coupon` (+ product rules), `CouponRedemption`, `GiftCard`/`GiftCardTxn`.
- **Shop / portal** — the storefront reads `InvProduct`; checkout is Razorpay, confirmed by the **signed webhook**, not the client response. Cart/wishlist/compare are Zustand + localStorage (no DB until checkout). Portal auth (`PersonPortalCredential`) is fully separate from the staff session — no crossover.

---

## 11) Data model map (`prisma/schema/`, split schema via `prisma.config.ts`)

| File | Key models |
|---|---|
| `base.prisma` | Person, Company, PersonCompany, Phone, Email |
| `accounts.prisma` | AccountGroup, Account, CustomerTierPeriod, CustomerTier |
| `finance.prisma` | **UniversalVoucher**, **VoucherGlLine**, VoucherLink, VoucherAllocation, VoucherSeries, VoucherPrintTemplate, BooksConfig, AuditLog |
| `inventory.prisma` | InvProduct(+Code/Branch), masters (InvUnit/Category/ProductGroup/Brand/WarrantyTerm/AttributeMaster/GstRate), **VoucherDetail**, **VoucherInventoryLine**, InvStockLedger, StockReservation, RedemptionHold, InvBom(+Line), StrategyPoint, AdditionalCostAllocation |
| `pos.prisma` | PosCounter(+PaymentAccount), PaymentGateway, PosShift, PosCashDrop, PosExpenditure, PosReceipt, PosHandover |
| `pipeline.prisma` | Pipeline, TicketStatus, TicketWorker, WorkGroup, Work, WorkerTransition, StatusTransition |
| `tickets.prisma` | Ticket, TicketRepair/Deal/Order(+Line)/Delivery/Refund, TicketLog, TicketParticipant, Device, ServiceCenter |
| `org.prisma` | Branch, Department, Position, UserPosition, PositionRole, Organisation, OrgDefaults |
| `rbac.prisma` | Role, Permission, RolePermission, UserPermission, DepartmentPermission |
| `users.prisma` | User, QuickNote |
| `loyalty.prisma` / `coupons.prisma` | loyalty + coupon/gift-card models |
| `inbox.prisma` / `social.prisma` / `portal.prisma` / `shop.prisma` | chat, wall posts, PersonPortalCredential, shop enums |
| `enums.prisma` | VoucherType, InvVoucherType, VoucherBinding, VoucherGlRole, VoucherStatus, PaymentMethod, GstRegType, … |

---

## 12) Shared structure & conventions (`src/shared/`)

```
src/shared/
├─ components/   cross-cutting UI (Sidebar, Topbar, PartySearchAndCreate, BranchSwitcher, print/*)
├─ hooks/        cross-cutting hooks (index.ts barrel)
├─ types/        cross-cutting types
└─ lib/
   ├─ api/       validateRequest, parsePagination, handleApiError, opaque-id gen
   ├─ auth/      permissions, permissionScope, posVoucherMatrix, voucherMatrix, sidebarModules,
   │             authorizeStaff/Portal, departmentPool, revokeSessions, loginRateLimit
   ├─ accountancy/ settlement, partySnapshot, checkCreditLimit, voucherBinding, outstandings
   ├─ format/    moneyInr (paise), round2, formatDate, numberWords
   ├─ prisma/    prismaClient singleton
   └─ print/     voucher/receipt templates
```

- **Boundary rule:** code goes in `src/shared/` only if used by ≥2 modules (or from `src/app/`); otherwise `src/modules/<m>/{lib,hooks,components}/`.
- **Naming:** components `PascalCase.tsx`; hooks `useThing.ts`; utilities/schemas/constants `camelCase.ts`; directories `kebab-case`.
- **Reuse before creating:** grep `src/shared/` first; export from the folder's `index.ts`.

---

## 13) Operational notes

- Use `pnpm`. After a Prisma schema change: `prisma generate` **and restart the dev server** (Turbopack caches Prisma chunks).
- Keep middleware in `src/proxy.ts` (never `middleware.ts`).
- Some columns were added via `prisma db push` with no migration recorded — generate migrations before a production deploy.
- **Production DB is in use** — check impact on seeds, APIs, and UI before removing anything (AGENTS.md).
- Seeds: `bootstrap-seed.ts` (production master data), `helper-*.ts` (trade-specific), `dummy-*.ts` (demo), `hard-clean.ts` (reset to bootstrap). See `docs/seeds.md`.
- Razorpay needs `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`.
- Protected surfaces (POS/GL posting, Balance Sheet, P&L, Day Book, accounting math): treat as append-only/verified — run the parity harness and confirm before changing (see PROJECT_BRAIN.md "protected" notes).
