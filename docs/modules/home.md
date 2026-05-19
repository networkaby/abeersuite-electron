# Home — Role-Aware Dashboard

> The `/office` landing page that every staff member sees after login.
> Shows a **Universal Customer Panel** (all staff, all channels) and a **Department Briefing** tailored to the user's assigned department(s).

## Four-layer design

```
LAYER 1 — Universal Customer Panel   (everyone, always — owner's rule: every staff member is a customer touchpoint)
LAYER 2 — Branch filter              (session.branchIds + activeBranch already scoped by existing helpers)
LAYER 3 — Department-based layout    (session.departmentIds → which briefing card to render)
LAYER 4 — Position-wise buttons      (hasPermission() inside each briefing component)
```

## URLs

### UI pages
- `/office` → `src/app/(protected)/office/page.tsx` — server component, renders universal panel + dept briefing(s)

### API routes
- `POST /api/quick-log` → `src/app/api/quick-log/route.ts` — any authenticated staff; creates a `CrmLead` in any pipeline (P2/P4/P6). No extra permission gate.
- `GET /api/tickets/lookup?q=` → `src/app/api/tickets/lookup/route.ts` — any authenticated staff; searches active tickets by customer name or phone (text query) or by ticket ID (numeric query). Returns `TicketLookupResult[]` (max 6). No scope restriction — home-panel-only universal endpoint.

## Permissions (gate keys)

None for the home page itself. `admin:bypass` (`PERMISSIONS.ADMIN_BYPASS`) routes admin users to `AdminBriefing` regardless of department.

Individual buttons inside briefings use existing module permissions (e.g. `pos:shift:open`).

## Prisma models

- `CrmLead` (`crm.prisma`) — generic info-only pipeline item. The `quick-log` endpoint creates rows here with `pipelineId` set to:
  - `"P6"` → CRM (sales query)
  - `"P2"` → Customer Support (helpdesk / customer problem)
  - `"P4"` → Internal Management (admin request, e.g. pay electricity bill, order from vendor)
- `PosShift` (`pos.prisma`) — counted for "open shifts" in ShowroomBriefing.
- `Invoice` (`finance.prisma`) — counted/summed for today's counter sales in ShowroomBriefing. POS invoices = `{ shopOrderId: null, ticketId: null, status: not VOID, deletedAt: null }`.
- `Ticket` (`repair.prisma`) — counted in RepairBriefing + DespatchBriefing.

## Department → Briefing mapping

| Department.id | Department name | Briefing component |
|---|---|---|
| `DEP-REPAIR` | Repairs | `RepairBriefing` |
| `DEP-SALES` | Sales | `ShowroomBriefing` |
| `DEP-DESK` | Front Desk | `ShowroomBriefing` |
| `DEP-FIN` | Finance | `FinanceBriefing` |
| `DEP-IT` | IT / Admin | `AdminBriefing` |
| `DEP-HR` | HR | `HrBriefing` |
| `DEP-DESP` | Despatch | `DespatchBriefing` |
| `admin:bypass` | (virtual — any admin) | `AdminBriefing` |

Users with multiple departments see all their briefings stacked. Users with zero departments see `NoDeptCard`.

## Key components

- `UniversalCustomerPanel` (`src/modules/home/UniversalCustomerPanel.tsx`) — client component. Two search inputs (product lookup via `/api/inventory/products/lookup`; repair status via `/api/tickets/lookup?q=` — accepts customer name, phone, or ticket #) + three log buttons (Sales Query → P6, Customer Problem → P2, Internal Request → P4 via `POST /api/quick-log`). Sales Query dialog includes a `CustomerPicker` backed by `usePartySearch` to link the lead to an existing `Person` record (`personId`).
- `RepairBriefing`, `ShowroomBriefing`, `FinanceBriefing`, `AdminBriefing`, `DespatchBriefing`, `HrBriefing`, `NoDeptCard` (`src/modules/home/DeptBriefings.tsx`) — async server components. Show live counts + quick-action links.

## Common workflows

1. **Log a sales query (phone/WhatsApp)**: Any staff → click "Sales Query" on Universal Panel → form opens → submit → `POST /api/quick-log` → `CrmLead` created in P6 → CRM team sees it in `/office/crm/`.
2. **Log a customer problem**: Any staff → click "Customer Problem" → form → `CrmLead` in P2 → Helpdesk team processes it (Helpdesk module UI, currently roadmap-planned at `/office/roadmap/helpdesk`).
3. **Log an internal request** (e.g. "Pay BESCOM bill", "Order CAT6 cable from vendor"): Any staff → click "Internal Request" → form → `CrmLead` in P4 → Admin processes it (Administration module, currently roadmap-planned).
4. **Quick product price check**: Any staff → type product name/SKU in Product Lookup → see price + stock without leaving the home page.
5. **Quick repair status**: Any staff → type ticket ID → see status + technician → or link out to the ticket page.

## Recent decisions / gotchas

- **CrmLead as generic pipeline item**: the same `CrmLead` model works for P2, P4, and P6. It has a `pipelineId` FK to `Pipeline`. The `POST /api/quick-log` uses `requireAuth()` (not `requirePermission(CRM_MANAGE)`) because this intake is staff-universal. Validation in the route was unified onto the shared zod-error pattern in commit `496f01d` (no public API change).
- **Department.id as stable key**: departments use stable IDs (`DEP-REPAIR`, `DEP-SALES`, etc.) — no `slug` field was added. The home resolver does a `switch(id)` on these string values. Do not change department IDs after data is in production.
- **ShowroomBriefing POS filter**: walk-in (POS) invoices = Invoice with `shopOrderId: null, ticketId: null, status != "VOID", deletedAt: null`. If a separate POS invoice model is ever added, update `ShowroomBriefing`.
- **Repair full dashboard**: the full repair module dashboard (TechnicianDashboard, FrontDeskDashboard, etc.) remains at `/office/repairing/`. The home page shows a lightweight briefing (counts + links) to avoid duplicating heavy data-fetch logic.

## Out of scope / deferred

- Multi-department tab strip (planned): when a user has multiple departments, currently all briefings are stacked vertically. A tab strip allowing switching between them is deferred.
- Position-level button permissions within briefings: currently `hasPermission()` guards are on individual module pages. Future iterations can add them inside briefing components too.

_Last updated: 2026-05-20 — covers initial four-layer home page implementation + quick-log validation refactor._
