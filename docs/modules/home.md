# Home — Permission-Aware Dashboard

> The `/office` landing page that every staff member sees after login.
> Shows a **Universal Customer Panel** (all staff, all channels) and a set of **briefing cards gated by permission** — a single common dashboard, the same for everyone, where each card appears only if the user holds a representative permission for that area.

> **Departments are deferred (2026-06-23).** The home page used to route briefings by `session.departmentIds`; it now selects them by permission instead. Departments are cosmetic for now — the department-routed layout returns when the department feature ships. See [PROJECT_BRAIN.md](../../PROJECT_BRAIN.md) "Known gotchas".

## Layered design

```
LAYER 1 — Universal Customer Panel   (everyone, always — owner's rule: every staff member is a customer touchpoint)
LAYER 2 — Branch filter              (session.branchIds + activeBranch already scoped by existing helpers)
LAYER 3 — Briefing cards             (gated by PERMISSION via hasPermissionWithScope — admin:bypass sees all)
LAYER 4 — Position-wise buttons      (hasPermission() inside each briefing component)
```

## URLs

### UI pages
- `/office` → `src/app/(protected)/office/page.tsx` — server component, renders universal panel + dept briefing(s)

### API routes
- `POST /api/quick-log` → `src/app/api/quick-log/route.ts` — any authenticated staff; creates a `CrmLead` in any pipeline (P2/P4/P6). No extra permission gate.
- `GET /api/tickets/lookup?q=` → `src/app/api/tickets/lookup/route.ts` — any authenticated staff; searches active tickets by customer name or phone (text query) or by ticket ID (numeric query). Returns `TicketLookupResult[]` (max 6). No scope restriction — home-panel-only universal endpoint.

## Permissions (gate keys)

No single gate guards the page itself — it always renders. Which briefing **cards** appear is decided per-card by `hasPermissionWithScope(user.permissions, …)`; `admin:bypass` short-circuits true, so admins see every card.

Individual buttons inside briefings use existing module permissions (e.g. `pos:shift:open`).

## Prisma models

- `CrmLead` (`crm.prisma`) — generic info-only pipeline item. The `quick-log` endpoint creates rows here with `pipelineId` set to:
  - `"P6"` → CRM (sales query)
  - `"P2"` → Customer Support (helpdesk / customer problem)
  - `"P4"` → Internal Management (admin request, e.g. pay electricity bill, order from vendor)
- `PosShift` (`pos.prisma`) — counted for "open shifts" in ShowroomBriefing.
- `InvVoucher` (`inventory.prisma`) — counted/summed for today's counter sales in ShowroomBriefing. POS bills = `{ type: "POS", status: "POSTED", date >= startOfToday }` (Layer 3d, 2026-05-24 — switched off the legacy `Invoice` filter when that table was retired).
- `Ticket` (`repair.prisma`) — counted in RepairBriefing + DespatchBriefing.

## Permission → Briefing mapping

Each card renders when the user holds (at any scope ≥ the one named, or via `admin:bypass`) one of these permissions:

| Briefing component | Shows when the user can… |
|---|---|
| `AdminBriefing` | `admin:bypass` **or** `users:manage` / `settings:manage` / `roles:manage` |
| `RepairBriefing` | `tickets:view:own` (any ticket-view scope) |
| `ShowroomBriefing` | `pos:shift:open` / `pos:shift:view:branch` / `tickets:create` |
| `FinanceBriefing` | `accountancy:view:own` / `finance:voucher:create` |
| `DespatchBriefing` | `inventory:view:branch` |
| `HrBriefing` | `users:manage` |

All qualifying cards stack (admins see every card). A user who qualifies for none sees `AllClearCard`. The mapping lives inline in [office/page.tsx](../../src/app/(protected)/office/page.tsx) (`showAdmin`, `showRepair`, …).

## Key components

- `UniversalCustomerPanel` (`src/modules/home/UniversalCustomerPanel.tsx`) — client component. Two search inputs (product lookup via `/api/inventory/products/lookup`; repair status via `/api/tickets/lookup?q=` — accepts customer name, phone, or ticket #) + three log buttons (Sales Query → P6, Customer Problem → P2, Internal Request → P4 via `POST /api/quick-log`). Sales Query dialog includes a `CustomerPicker` backed by `usePartySearch` to link the lead to an existing `Person` record (`personId`).
- `RepairBriefing`, `ShowroomBriefing`, `FinanceBriefing`, `AdminBriefing`, `DespatchBriefing`, `HrBriefing`, `AllClearCard` (`src/modules/home/DeptBriefings.tsx`) — async server components. Show live counts + quick-action links. (`NoDeptCard` also still lives here, unused until department routing returns.)

## Common workflows

1. **Log a sales query (phone/WhatsApp)**: Any staff → click "Sales Query" on Universal Panel → form opens → submit → `POST /api/quick-log` → `CrmLead` created in P6 → CRM team sees it in `/office/crm/`.
2. **Log a customer problem**: Any staff → click "Customer Problem" → form → `CrmLead` in P2 → Helpdesk team processes it (Helpdesk module UI, currently roadmap-planned at `/office/roadmap/helpdesk`).
3. **Log an internal request** (e.g. "Pay BESCOM bill", "Order CAT6 cable from vendor"): Any staff → click "Internal Request" → form → `CrmLead` in P4 → Admin processes it (Administration module, currently roadmap-planned).
4. **Quick product price check**: Any staff → type product name/SKU in Product Lookup → see price + stock without leaving the home page.
5. **Quick repair status**: Any staff → type ticket ID → see status + technician → or link out to the ticket page.

## Recent decisions / gotchas

- **CrmLead as generic pipeline item**: the same `CrmLead` model works for P2, P4, and P6. It has a `pipelineId` FK to `Pipeline`. The `POST /api/quick-log` uses `requireAuth()` (not `requirePermission(CRM_MANAGE)`) because this intake is staff-universal. Validation in the route was unified onto the shared zod-error pattern in commit `496f01d` (no public API change).
- **Departments no longer drive the home page (2026-06-23)**: the briefing selector was switched from `switch(departmentId)` to per-card permission gates (`hasPermissionWithScope`). Department IDs are still stable keys (`DEP-REPAIR`, etc.) used elsewhere (org chart, `user.departmentIds`), but the home page ignores them. Department-routed layout is deferred until the department feature ships — don't re-introduce dept branching here before then.
- **ShowroomBriefing POS filter**: walk-in (POS) bills = `InvVoucher` with `type=POS`, `status=POSTED`, `date >= startOfToday`. Cash sales sum derives from the bill's non-AR tender rows via the same shape used by `sumShiftCashSalesPaise` (see [pos.md](./pos.md)).
- **Repair full dashboard**: the full repair module dashboard (TechnicianDashboard, FrontDeskDashboard, etc.) remains at `/office/repairing/`. The home page shows a lightweight briefing (counts + links) to avoid duplicating heavy data-fetch logic.

## Out of scope / deferred

- **Department-routed dashboard (deferred)**: one briefing card per department (and the multi-department stack / tab strip) returns when the department feature is built. Until then the dashboard is common + permission-gated.
- Position-level button permissions within briefings: currently `hasPermission()` guards are on individual module pages. Future iterations can add them inside briefing components too.

_Last updated: 2026-06-23 — **Home dashboard switched from department-routed to common + permission-gated.** Each briefing card now shows by `hasPermissionWithScope` (admin:bypass sees all) instead of `switch(departmentId)`; `NoDeptCard` fallback replaced by `AllClearCard`. Departments are cosmetic for now (deferred). Previously (2026-05-24): Layer 3d — ShowroomBriefing migrated off `Invoice` onto `InvVoucher` (`type=POS, status=POSTED`)._
