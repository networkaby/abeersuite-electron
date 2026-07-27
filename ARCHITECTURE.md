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
`bi` — Business Intelligence: management decision reports (customer/item/bill-wise profit, top-N customers, RFM segmentation, party sale & purchase, item-by-party, ABC analysis, FSN & dead stock, stock turnover, movement register, sales trend/seasonality with YoY, branch comparison, discount impact incl. bill-level coupon/loyalty, basket analysis, supplier purchases with attributed profitability — sale profit prorated across suppliers by purchased-qty share, opening/older stock as its own row — purchase price variance, inactive customers) on a shared margin engine (`modules/bi/lib/marginEngine.ts`, purchase twin `purchaseLines.ts`) that shapes sale lines into revenue/COGS/profit; the cost basis itself is the shared `modules/inventory/lib/costBasis.ts` (`loadUnitCostMap` — inward stock-ledger lots capped at the period end, since no cost is stored at sale time and outward ledger rows carry the SELLING rate), which the accountancy trading account also uses to price issued goods, so P&L gross profit cannot drift from Bill-wise Profit; pages under `/office/bi`, APIs under `/api/bi/*` (requireAuth reads), charts via recharts.
`repairing` · `deals` · `order` · `delivery` · `refund` — the pipeline/ticket flavours.
`customer` (contacts) · `admin` · `administration` · `settings` · `home` · `message` · `core` — org, contacts, workspace.
`ecommerce` (staff shop admin) · `external` (customer-facing shop/store/portal UI) · `lab` (throwaway prototype, not production).

Cross-cutting code lives in `src/shared/` (see §12). shadcn primitives live in `src/components/ui/`. Accepted legacy homes (leave in place): `src/utils/`, `src/store/`, `src/components/ui/`.

---

## 3) Route groups (`src/app`)

- **`(protected)/office/*`** — staff app (requires a staff session). Segments mirror URLs 1:1: `accountancy`, `bi` (Business Intelligence reports), `inventory`, `pos` (manager shift reports), `pricing-strategy`, `customer-retention`, `customers` (Contacts), `crm`, `orders`, `repairing`, `ecommerce`, `admin`, `administration`, `settings`, `work-flow-inbox` (post-login landing).
- **`(protected)/vouchers/pos`** — the POS register (operator surface), opened standalone. `/vouchers/pos/new` is the New Sale screen.
- **`(external)/*`** — customer-facing: `(store)` marketing homepage, `shop` (catalogue → cart → checkout with courier + payment-method pickers), `portal` (customer self-service), `login` (portal sign-in).
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

- **`UniversalVoucher`** (`finance.prisma`) — the header/anchor: `type` (spans all kinds), `status`, `binding` (`REGULAR` = real transaction with GL/stock, `OPTIONAL` = non-binding document like estimate/order), `date`, `branchId`, `partyAccountId`, `voucherNo` (per-kind series number), creator. The global number is the row `id` (`UV-<id>` via `formatUvNo`). `denomJson` (nullable) holds a contra's final cash-denomination + cheque breakdown for the bank-deposit / cash-handover slip (print-only capture, not a GL leg).
- **`VoucherGlLine`** — the Dr/Cr postings, each tagged by `VoucherGlRole` (body / tax / tender / charge / round-off). Tender legs (cash/bank/AR) are GL lines, not a separate table.
- **`VoucherDetail`** (`inventory.prisma`) — a 1:1 sidecar holding only cosmetic/print fields (frozen party JSON, GST/place-of-supply, printed totals, settlement JSON, return links). *(This is the model formerly named `InvVoucher`.)*
- **`VoucherInventoryLine`** + **`InvStockLedger`** — the goods lines and stock movements. The mere existence of inventory lines ⇒ it's an inventory voucher (no discriminator).
- **`VoucherLink`** — loose, FK-free workflow links (ticket/deal/order/shop-order) so the ledger stays decoupled from the disposable workflow.
- **`VoucherAllocation`** — settlement links (receipt → the bills it clears; advance → against-ref).

**The Transaction Engine** (`src/modules/accountancy/lib/transactionEngine.ts`) is the single internal ledger writer. A posting voucher funnels through **`enginePost(spec)`**, which drives two arms inside the *caller's* transaction (atomic; the engine never opens its own tx):

- **`engineGlArm`** — writes the balanced `VoucherGlLine` set + `Account.balance` deltas.
- **`engineStockArm`** — writes `InvStockLedger` + `InvProduct`/`InvProductBranch` stock caches.

`engineCreateSpine` mints the draft header up front (document anchor) so goods lines hang off it before posting. Closing stock / COGS is **not** posted per voucher — it's computed live at report time (Tally-style). Opening-balance mismatches route to a system **Suspense** ledger so the trial balance always balances.

**The `Account` is the bridge.** Party ledgers (`accounts.prisma`: `AccountGroup` → `Account`) are the one durable link between the protected accounting core and the disposable workflow. Bank-group ledgers carry `Account.bankJson` (bank name / branch / A-C no / IFSC / holder) that prints on the contra deposit slip. The GL posting path, balances, and reports (BS / P&L / Day Book / Trial Balance) are a **protected surface** — verify with the parity harness and confirm before changing the math (see PROJECT_BRAIN.md).

---

## 6) Inventory

- **`InvProduct`** is the single source of truth for storefront + warehouse + POS (carries `hsnCode`, `gstRate`, `taxability`, `attrsJson`, naming config). No separate shop product.
- Masters: `InvUnit`, `InvCategory`, `InvProductGroup`, `InvBrand`, `InvWarrantyTerm`, `InvAttributeMaster`, `GstRate`, `InvBom`/`InvBomLine`.
- **Unit chains** (`InvUnit.baseUnitId` + `conversionFactor`): each unit names its **immediate** parent and how many of it it holds — `1 KM = 1000 M`, `1 M = 100 CM`. A unit with no parent is a **root**; a unit's true size is the **product of its chain** (KM = 100,000 CM). One base may carry many compounds (PAIR/DOZ/SCORE all on NOS), and units sharing a root are **related**. Quantities are **always stored in the root unit** — `InvProduct.stock`, `openingStock` and `InvStockLedger.inQty/outQty` never hold a converted value — so valuation, costing and the `Int` stock cache are untouched; the chain is purely a rendering (`unitFormat.ts` → `unitTiers`/`formatQtyInTiers`/`relatedUnits`, resolved server-side and sent as `tiers`). Adding or changing a link is refused while any product on that unit holds stock (it would silently re-read existing quantities), and cycles / chains deeper than 8 are rejected (`unitCompoundGuard.ts`). Voucher-line entry is still in the root unit — a per-line unit picker is not built.
- Stock: `InvProductBranch` (per-branch stock), `InvStockLedger` (movements), `StockReservation` / `RedemptionHold` (soft holds).
- Pricing: `pricing-strategy` module + `StrategyPoint`; costing via `AdditionalCostAllocation`.
- **Movement classification** (`inventory/lib/movementClass.ts` — the house lens, distinct from BI → FSN's turnover lens): every product classifies **New / Regular / Slow / Non-moving / Dead** by days-since-last-sale against bands resolved **group chain → category chain → `OrgDefaults.reorder*AfterDays`** (universal 30/90/180 + new-item 60; per-group/category overrides in the Masters dialogs — CCTV vs consumables get their own calendars). **Organic vs clearance:** a sale line whose realized pre-tax unit price ≤ cost × (1 + `OrgDefaults.clearanceMarginCutoffPct`%, default 1) — or any free qty — is clearance: stock leaving, never demand (feeds no usage, refreshes no recency, climbs no ladder; dumping dead stock at discount can't resurrect its buy signal). Internal consumption (manufacturing outQty) stays organic — the demand-translation path for in-house parents. **Promotion ladder** (organic days only; demotion is recency-automatic): 1 lone day = `blip` (class unchanged, judged by the gap before it); ≥2 organic days in the slow window → Slow (amber checkpoint); ≥4 → Regular (buy math resumes). Consumed by the Reorder page, the Products-list badge, and **BI → Stock Health** (`/office/bi/stock-health` — class, last sale, band + source, value locked, and the action Reorder takes).
- **Reorder** (`/office/inventory/reorder` + `/api/inventory/reports/reorder`): reorder level = avg daily usage (class-driven window: Regular = slow band, Slow = non-moving band) × lead time (`InvProduct.leadTimeDays` ?? `OrgDefaults.defaultLeadTimeDays`), floored by the manual `lowStockThreshold`. Treatment by class: Regular → red LOW = buy; Slow → amber REVIEW (never auto-pushed); New → floor only; Non-moving / Dead / BOM outputs (in-house) → the collapsed **Skipped** section with per-row reasons — skipped is stated, never silent. Lead time + floor edited inline or bulk-applied (`/api/inventory/products/bulk-reorder`, filter → select → apply). The **Smart tab** (`?grouped=1&tolerance=x`) pools substitutes: considered items in the same leaf product group whose last-inward cost (opening cost counts, via the valuation cascade) sits within x% of the band's cheapest member share one pooled level (Σ usage, Σ available, max lead, max floor); member rows carry cost + margin% for the which-brand-to-procure call; Group/Category/Brand section views repeat a band under every member value (supplier-order view) with the section's member highlighted.

---

## 7) POS

- Tills are **counter-based, not user-based** — any cashier works any counter; variance lands on the counter account, and human accountability comes from the shift report.
- Models (`pos.prisma`): `PosCounter` (+ `PosCounterPaymentAccount`, `PaymentGateway`), `PosShift` (`OPEN → AWAITING_HANDOVER → CLOSED`), `PosCashDrop`, `PosExpenditure`, `PosReceipt`, `PosHandover`.
- A sale requires an **OPEN shift on a counter** — the create route returns `NO_OPEN_SHIFT` otherwise. Branch context comes from the shift, not the session cookie (parallel billing from many browsers).
- POS create routes gate on **`requirePosVoucher`** (the `pos:voucher:create:<kind>` tick), because a counter operator holds `ui:sidebar:workspace:pos`, not the office `ui:sidebar:pos:*` module.
- A POS sale is a `UniversalVoucher` (`type=POS`) with tender/charge GL lines, stock movement, GST routing, and optional loyalty/coupon/gift-card effects — one balanced posting via `enginePost`.
- **Shipping carries GST** (composite supply): the counter-typed shipping amount is tax-inclusive; the embedded GST (`VoucherDetail.shippingTaxAmt`) is back-calculated at the bill's rate — the rate group holding >50% of the pre-tax goods value, else the max rate on the bill; service rates when the bill has no goods (`resolveShippingGstRate` in `inventory/lib/stock.ts`). GL posts Shipping Income **net** with the tax pooled onto the CGST/SGST/IGST legs; the printed receipt's tax box shows the same pool (line + service + shipping GST).

---

## 8) Workflow — pipelines, tickets & the work engine

The pipeline engine models a **journey**, three levels deep: `Pipeline` → `TicketStatus` (stages) → `TicketWorker` (sub-statuses inside a stage). One **`Ticket`** core row rides every pipeline; `Pipeline.entityType` (`repair` | `deal` | `order` | `delivery` | `refund` | `task` | `none`) selects the optional 1:1 detail table — `TicketRepair`, `TicketDeal`, `TicketOrder`/`TicketOrderLine`, `TicketDelivery`, `TicketRefund` (`task`/`none` = a bare core row). Cross-pipeline transfer is just an `update { pipelineId, status }` on the core row; the detail row stays attached as history.

Each `TicketStatus` carries an optional **resolve-time SLA** (`resolveTimeHours`); a ticket in that status longer than that many hours is **overdue**. `Ticket.statusEnteredAt` (stamped only on a real status change, defaulting to `now()`) is the clock — measured against it, not the edit-bumped `updatedAt`. A status can also carry a **fallback `resolveGroup`** (`resolveGroupId`, settable in Settings → Workflow → Statuses) — a WorkGroup tag for its overdue tickets to show under when the status has no work-bearing worker of its own; the field exists and is editable but the Work Inbox query doesn't consume it yet (a status with no Work-bearing worker still doesn't surface there at all).

`TicketLog` is the single timeline (actor is a frozen JSON snapshot, not a User FK). It usually hangs off a `Ticket`, but a row can instead point straight at a `Person`/`Company` (`personId`/`companyId`, `ticketId` null) — a note/call logged onto a customer by the **CRM Reconnect** page (§9). `Device` + `ServiceCenter` support repair. Ownership = `createdBy` snapshot; assignment = `assignedPositionId` seat; `TicketParticipant` adds helpers. The **Work Inbox** (`/work-flow-inbox`, the post-login landing) lists tickets for the operator, with a filter chip per work-group. Chips are derived from the groups the caller's *visible* items actually carry and **merged by label** — two same-named groups scoped to different teams collapse into one chip. SLA-breached tickets float to the top of whichever chip is active, flagged red **"Needs attention"** (no separate chip — the flag stays inside the group that owns the work).

**The sub-status carries the automation.** A `TicketWorker` completes through `/api/tickets/[id]/worker`, driving:

- **Work units.** A `Work` is the unit of work a status/sub-status represents (calling, parts, QC). A Work carries **many `WorkGroup` tags** (many-to-many via `WorkGroupWork`) — so one work can be tagged by both *type* (Calling) and *team* (Repair) at once, since a single group axis can't hold both. The Work owns the completion *vocabulary* (success/fail labels, popups, args); the worker owns the *wiring*. `Work.kind` is `"human"` (completed on the Work Inbox) or `"auto"` (a hardcoded tool runs it — `actionTools.ts` / `toolRegistry.ts`). A gated `Work` / `WorkGroup` mints a `work:<id>` / `workgroup:<id>` permission (act-on vs see-in-inbox).
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
- **Customer Quality** (internal-only — never exposed to the customer): `Person`/`Company` carry `noDiscount` (Boolean), `qualityLog` (Json append-only timeline of `{rating|comment}` entries with denormalised author name/avatar, timestamp, source `pos|office` + counter name), and `customerGroupId` → **`CustomerGroup`** (marketing-segment master, Settings → Customer Groups, `customers:edit` nav permission). Surfaces: the **Quality tab** on `customers/all` (flag toggle gated by `customers:edit` credit-limit-style; stars + comment timeline open to all staff) and the **POS customer panel** (tap-to-rate stars + staff notes with the counter name; no flag UI). The **no-discount flag** = bill at barcode price: `/api/pos/sale`, `/api/pos/coupon-validate`, the POS `account-snapshot` and `computeShopCartBenefits` (shop preview + orders) all strip tier discount, coupons and loyalty (earn + redeem + milestones) server-side, silently — the cashier's manual discount still works; the ecommerce invoice route still burns a redemption frozen before the flag was set but earns nothing. Timeline entries append via `POST /api/customer-quality`; helpers in `modules/customer/lib/customerQuality.ts`.
- **Reconnect** (`/office/crm/reconnect`, CRM module — gated by `ui:sidebar:crm:reconnect`) — a customer-centric re-engagement workbench. The **left** pane is a flat **filter checklist** (Zoho-style): every filter is always visible by name; tick to activate, untick keeps its values (retick restores); header shows "N on · Clear all". The catalog (`reconnectFilterSchema`, all optional, grouped): **activity** — mode `quiet`|`never`|`all`, has/hasn't an interaction *type* (any·sale·repair·inquiry·deal·note) over a "last X to Y days ago" window (a past period / festive season; blank = ever), call log by direction (incoming/outgoing/any) over a window; **sold-to-customer** (labelled "Sold"/"Not sold", NOT supplier procurement) — we sold / didn't sell them a category-or-product over a days-ago window, warranty ending ≤N days over chosen warranty terms (derived = purchase date + `InvProduct.warrantyTerm.durationDays`); **value** — revenue (turnover) and profit (derived margin via `bi/lib/marginEngine`) as ₹ min–max over a days-ago window; **segment** — stage · group · owner · type. Every time window is the shared "last X to Y days ago" shape. The engine (`modules/crm/lib/reconnectCandidates.ts`) resolves each active filter to a keep-set (account-keyed or customer-keyed), intersects, trims the universe, then ranks quietest-first (last-activity = newest of posted vouchers, tickets, deals, inquiries, notes). Heavy per-account queries run only when their filter is ticked. The whole checklist state can be **saved as a named view** (Zoho-style, personal or shared-with-team) in the generic **`SavedFilter`** table (`surface="reconnect"`) via `GET|POST /api/crm/reconnect/filters` + `PATCH|DELETE .../filters/[id]` (owner-only edit/delete). The **right** pane has two tabs: **Timeline** — the customer's **own merged feed** + auto talking points (`customerTimeline.ts` — "we serviced your printer…", "you bought a laptop…"), a note/call composer (`TicketLog` with `personId`/`companyId`, no ticket; a CALL captures incoming/outgoing on the log's `data` JSON) **plus auto-captured PBX calls merged in by phone** (the `Call` table — see Call Log below), lifecycle-stage editor (both Person & Company) with a per-customer **Refresh** button (`POST /api/crm/reconnect/refresh-stage` — rechecks for any real posted sale/repair and bumps Lead/Prospect → Customer; never downgrades, never touches Inactive) plus a left-pane **"Refresh all stages"** bulk action (`POST /api/crm/reconnect/refresh-stage/all` — two batched "who has transacted" queries + two `updateMany`, no per-customer round trips) that runs without blocking the page, for imported contacts that were already transacting before Reconnect existed, and a Deal spin-off on interest; the list is sortable (quietest-first · recently-active · name); **Items** — buying behaviour, products aggregated with qty/times/spend + derived per-item warranty-end (`customerItems.ts`), to spot consumables to re-pitch. APIs: `GET /api/crm/reconnect/{candidates,timeline,items}`, `POST .../log`, `PATCH .../stage`.
- **Call Log** (`/office/crm/call-log`, CRM module — gated by `ui:sidebar:crm:call-log`) — the raw phone-call stream from the shop's Matrix PBX. The combined-bridge's **ePBX module** (`epbx.js` — a TCP SMDR listener on :5000, running in the same on-premise bridge process as the thermal/QR relays, installed on **every** PC — we can't predict which PC is powered on, so all run the listener for availability) POSTs every call to **`POST /api/calls`** (machine endpoint, `x-api-key` = `CALLS_API_KEY`). Each call is stored in the **`Call`** table — a raw firehose with **no customer FK**: it keeps the normalized `phone` (last-10 key, `phoneMatchKey`), direction, extensions, durations, status, the raw SMDR line, an editable `note`, and a `spam` flag. Idempotency is a **`@unique` on the raw SMDR line** (race-proof at the DB level — bridge retries, several PCs pushing the same call at once, and buffered replays all collapse to one row; the API returns `duplicate:true` for the losers); `occurredAt` is parsed from the record's own date+time (not receive time). Matching to a customer is **by phone at read time** — so a call logged before the customer existed appears in their Reconnect timeline the moment they're created with that number, and no unknown caller is ever auto-made into a lead. The page lists calls (filters: missed, direction, spam, search), resolves each to a customer (or "Unknown") via `Phone`, and offers triage: create a lead from an unknown number, flag a number as **spam** (applied to every call sharing that `phone`, kept but hidden from the CRM), or edit the note (`PATCH /api/calls/[id]`).

---

## 10) Adjacent domains

- **Loyalty** (`loyalty.prisma`) — points earn/redeem with expiry lots (`LoyaltyLot`/`LoyaltyLedger`), tiers, milestones; applied inside the POS sale tx.
- **Coupons / gift cards** (`coupons.prisma`) — `Coupon` (+ product rules), `CouponRedemption`, `GiftCard`/`GiftCardTxn`.
- **Shop / portal** — the storefront reads `InvProduct`; cart/wishlist/compare are Zustand + localStorage (no DB until checkout). Checkout picks a **courier** (hard-coded catalog — Local delivery / Standard courier / Shiprocket / Shipway aggregators / Pickup from store (always ₹0, config note shown to the customer; optional `configJson.include` serve list — empty = everywhere) / Free delivery (₹0, offered only inside its `configJson.include` serve list of states + pincode prefixes; empty = nowhere) — both serve lists share the exclude's shape/matcher, and the common `exclude` blocks pockets inside a served area — aggregators curated into an N-slot list by `delivery/lib/shippingQuote.ts`) and a **payment method**: Pay-on-Delivery (area rule on `configJson.area`) or an online gateway (Razorpay / PayU / Cashfree / demo). Payment methods are a fixed, self-healing catalog (`PAYMENT_METHOD_DEFAULTS` in `pos/lib/paymentGateways.ts`; no add/delete via UI); each carries a **settlement ledger** (`configJson.settlementAccountId`) and a gateway **without one is not offered** at checkout.
- **Customer benefits online (tier + coupons + loyalty)** — a logged-in customer gets the same benefits as at the POS counter, finalized together by the POS stacking rules (`finalizeCouponAmount`: a non-stackable coupon drops the tier and cannot combine with points — explicit code → hard error, AUTO offer → silently skipped in favour of the chosen points; the global discount guard clamps the coupon). **Tier**: the shared resolver (`shared/lib/pricing/tierSpend.ts` — brackets score POSTED `SALE`+`POS`+`ONLINE_INVOICE` spend, so every channel feeds one ladder) + the POS formula (tier% × cost-excl per line, pre-tax, clamped). **Coupons**: the shared `selectCouponForCart` engine on channel `SHOP` — typed code (checkout code box) or the best AUTO offer. **Loyalty**: checkout shows the points balance + a redeem box; requested points are clamped by POS's `clampRedemption` (balance ∧ floors ∧ the cart-aware per-line redeem-cap ceiling). All three live in `ecommerce/lib/shopTierDiscount.ts` (`computeShopCartBenefits`); the cart + checkout pages preview them live (`POST /api/shop/tier-preview`); `/api/shop/orders` recomputes server-side and **freezes** them on the order (`TicketOrder.tierDiscount*`/`coupon*`/`loyaltyRedeem*` + per-line `TicketOrderLine.tierDiscountPaise`); `totalPaise` is stored NET so gateways/COD charge the discounted amount. The coupon's **usage slot is taken at checkout** (a `CouponRedemption`, spine null, written atomically with the order; the invoice stamps its spine onto it); loyalty points are only **validated** at checkout — lots burn when the invoice posts. Guests see plain prices.
- **Online payment → books.** Gateway success is verified server-side (Razorpay HMAC signature / PayU reverse-hash / Cashfree order-status query) → `markOrderPaid` flips the order PAID, auto-posts an **advance RECEIPT** (Dr the gateway's settlement ledger · Cr the customer, HQ branch, attributed to the first admin) and auto-confirms the order (reserve stock + spawn delivery). Staff then one-click converts the order into a posted **`ONLINE_INVOICE`** (`POST /api/ecommerce/orders/[id]/invoice`) built with the **same structure as a POS sale** — engine-direct (spine + `VoucherDetail` + lines + `settlementJson` AR tender → `saleToSpec`/`enginePost`, no HTTP self-calls): GST backed out of the tax-inclusive storefront prices, the frozen tier discount replayed per line (gross subtotal + **Discount Allowed** leg), the frozen coupon + loyalty redemption replayed as their **negative charge rows** (Dr the coupon-expense / loyalty-redeemed ledgers — the POS shape), **shipping GST** via `resolveShippingGstRate`, a ≤5p Round-Off snap so the invoice total equals the paid amount exactly, stock OUT, reservation → EXECUTED, linked via `VoucherLink SHOP_ORDER`, and the advance receipt allocated against it. In the same tx the invoice **burns the frozen loyalty points, earns on the goods, and awards lifetime-spend milestones** (`applyLoyaltyForSale`/`applyMilestones`, guarded 422 `LOYALTY_POINTS_GONE` when the balance no longer covers the frozen points) — one points pot across counter and web. The order pipeline **blocks Packing / Dispatched / Delivered until that posted invoice exists**; the invoice itself stays a normal, editable voucher. It prints from the order page on its **own `ONLINE_INVOICE` print template** (seeded as a duplicate of the POS receipt; renders the same customer discount ladder — the parcel-insert print).
- **Courier fulfilment (P8) automation** — order Confirmed spawns the delivery with the checkout courier snapshot. Staff can **change the courier** pre-Packing (`/api/ecommerce/orders/[id]/courier`: GET re-quotes live options, POST swaps the snapshot + delivery carrier — the customer's paid shipping charge never changes; PATCH saves a **manual tracking number** for our own couriers, which are always booked by hand). Moving to **Packing auto-books** API couriers best-effort (`ecommerce/lib/orderStatus.ts` → `pushDeliveryToShiprocket` / `pushDeliveryToShipway`): shipment on the exact chosen carrier, AWB, pickup request, label, AWB stamped on delivery + order; a failure alerts the staff inbox and never blocks packing ("Book courier now" on the order page retries, reusing the already-created shipment). **Stage sync**: carrier webhooks `/api/shop/delivery-updates` (Shiprocket, `x-api-key`) and `/api/shop/shipway-updates` (token on `?token=`) map scans → the P8 stage and mirror milestones forward-only onto the order via `delivery/lib/mirrorOrderStage.ts` (moving → Dispatched, delivered → Delivered, `shippedAt`/`deliveredAt` stamped); "Refresh tracking" polls the same mapping when a webhook isn't configured. **Labels**: aggregator shipments print the carrier's own PDF (`/api/deliveries/[id]/{shiprocket,shipway}/label`); own-courier orders print the bespoke **`DELIVERY_SHIPPING_LABEL`** parcel label (`/shipping-label/order/[orderId]` — 4×6" roll / A4 2-up / 80mm strip, COD banner + AWB barcode, customizable in Print Templates). **Manifests** (pickup handover sheet): Shiprocket returns a printable PDF, Shipway a manifest id (printed from its panel).
- **Online returns & refunds** (`POST /api/ecommerce/orders/[id]/return`, mode `RTO` | `CUSTOMER`) — one click posts a full **`SALE_RETURN`** credit note against the linked `ONLINE_INVOICE` (engine-direct, POS-return parity: per-line GST + prorated tier discount reversed, loyalty clawed-back/restored, coupon slot freed, stock IN, refund tender = customer AR) and moves the order to Returned. `RTO` (courier reported delivery failed, parcel received back) also **reverses shipping income + its GST** and refunds the **full paid amount incl. shipping**; `CUSTOMER` (returned after delivery) refunds the **goods amount only**. Paid orders auto-spawn a **P9 refund** linked to the order's advance-receipt spine, so the Refund board's Refunded step pays back **Dr customer / Cr the gateway settlement ledger** the money arrived in. The order page's Return/Refund panel drives both cases and shows the credit note + live refund stage.
- **Portal My Orders** (`/portal/orders`) — the customer's real orders across personal + linked company accounts; each card expands in place (details / journey timeline with live courier movement) and downloads the posted `ONLINE_INVOICE` as A4 PDF via the print-template view.
- Portal auth (`PersonPortalCredential`) is fully separate from the staff session — no crossover.

---

## 11) Data model map (`prisma/schema/`, split schema via `prisma.config.ts`)

| File | Key models |
|---|---|
| `base.prisma` | Person, Company, PersonCompany, Phone, Email, CustomerGroup |
| `accounts.prisma` | AccountGroup, Account, CustomerTierPeriod, CustomerTier |
| `finance.prisma` | **UniversalVoucher**, **VoucherGlLine**, VoucherLink, VoucherAllocation, VoucherSeries, VoucherPrintTemplate, BooksConfig, AuditLog |
| `inventory.prisma` | InvProduct(+Code/Branch), masters (InvUnit/Category/ProductGroup/Brand/WarrantyTerm/AttributeMaster/GstRate), **VoucherDetail**, **VoucherInventoryLine**, InvStockLedger, StockReservation, RedemptionHold, InvBom(+Line), StrategyPoint, AdditionalCostAllocation |
| `pos.prisma` | PosCounter(+PaymentAccount), PaymentGateway, PosShift, PosCashDrop, PosExpenditure, PosReceipt, PosHandover |
| `pipeline.prisma` | Pipeline, TicketStatus, TicketWorker, WorkGroup, Work, WorkerTransition, StatusTransition |
| `tickets.prisma` | Ticket, TicketRepair/Deal/Order(+Line)/Delivery/Refund, TicketLog, TicketParticipant, Device, ServiceCenter |
| `org.prisma` | Branch, Department, Position, UserPosition, PositionRole, Organisation, OrgDefaults |
| `rbac.prisma` | Role, Permission, RolePermission, UserPermission, DepartmentPermission |
| `users.prisma` | User, QuickNote, SavedFilter (named list views, generic on `surface`) |
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
   ├─ api/       validateRequest, parsePagination, handleApiError, opaque-id gen,
   │             requestBusinessDate (staff browser date via x-business-date, else shop timezone)
   ├─ auth/      permissions, permissionScope, posVoucherMatrix, voucherMatrix, sidebarModules,
   │             authorizeStaff/Portal, departmentPool, revokeSessions, loginRateLimit
   ├─ accountancy/ settlement, partySnapshot, checkCreditLimit, voucherBinding, outstandings, denomJson
   ├─ constants/ ACCOUNT_GROUPS, PERMISSIONS, BUSINESS_TIME_ZONE (the shop's zone — one editable line)
   ├─ format/    moneyInr (paise), round2, numberWords; formatDate — calendar-date helpers
   │             (startOfDayUtc/endOfDayUtc query bounds, toDateOnlyUtc echo, businessToday/Iso fallback)
   ├─ prisma/    prismaClient singleton
   └─ print/     voucher/receipt templates (A4 + thermal), per-kind bespoke bodies — bank deposit slip, cash handover slip, money receipt, journal (Dr/Cr), invoice
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
- Seeds: `pnpm prisma db seed` runs `personal-bootstrap.ts` (production restore = code-owned catalog from `lib/codeOwnedCatalog.ts` + the captured `data/personal.local.json` snapshot; upsert-only). `bootstrap-seed.ts` is the generic new-client installer (`pnpm seed:generic`). `helper-*.ts` (trade-specific), `dummy-*.ts` (demo), `hard-clean.ts` (reset to bootstrap). See `docs/seeds.md`.
- Gateway env (presence shown as ✓/✗ on Settings → Payment Methods, values never stored): `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, `PAYU_MERCHANT_KEY`/`PAYU_MERCHANT_SALT`, `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY`. Courier aggregators: `SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD` (+ optional `SHIPROCKET_WEBHOOK_TOKEN`), `SHIPWAY_USERNAME`/`SHIPWAY_LICENSE` (+ optional `SHIPWAY_WEBHOOK_TOKEN` — the Shipway webhook form takes only a URL, so the token rides `?token=` on the registered URL).
- Protected surfaces (POS/GL posting, Balance Sheet, P&L, Day Book, accounting math): treat as append-only/verified — run the parity harness and confirm before changing (see PROJECT_BRAIN.md "protected" notes).
