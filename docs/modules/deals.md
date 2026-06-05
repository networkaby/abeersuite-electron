# Deals

> HubSpot-style deal pipeline for sales deals (device-less). Rides the shared `Pipeline` / `TicketStatus` tables on the seeded **P6 "deals"** pipeline (Deal → Contacted → Qualified → Proposal Sent → Negotiation → Won / Lost). Like the Administration work board, a deal is **owned by a Position (seat)** — the current holder is resolved live via `UserPosition`, so deals transfer automatically on staff change — and the actor of an action is a **frozen JSON snapshot** (`ActorSnapshot`), not a User FK. Rebuilt 2026-06-05 from a bare list-only Deals into a kanban board + activity timeline.

## URLs

### Layout / page
- `office/deals/layout.tsx` — permission gate (`deals:view`) + `PathBreadcrumb` root "Deals" + `escapeBack` (mirrors the Administration layout).
- `office/deals/page.tsx` — SSR shell. Loads the P6 stages (via `getDealsPipeline`), the Position list (owner options), the current user's held position ids ("My deals"), then renders the client `DealsWorkspace`.

### UI page
- `/office/crm/deals` — **Deals Pipeline** workspace: **Board** tab (kanban, one column per stage) + **List** tab (searchable table). Header shows deal count + total pipeline value.

> Sidebar: the "Deals" `MODULE_SECTIONS` entry (`src/utils/constants.ts`) is gated by `deals:view`; child **Pipeline** → `/office/crm/deals`; `createActions` **"New Deal +"** → `/office/crm/deals?new=1` (deep-link opens the create dialog).

### API routes
- `GET /api/deals` — all P6 deals for the board (`?q=` optional search). Gate `deals:view`.
- `POST /api/deals` — create on entry stage S35; `createdBy` JSON snapshot. Gate `deals:manage`.
- `GET /api/deals/[id]` — detail + activity timeline.
- `PATCH /api/deals/[id]` — edit / move stage (`{status}`) / reassign (`{assignedPositionId}`) / link customer / set follow-up. SYSTEM activity on stage/owner change; `closedAt` stamped on a terminal stage (Won/Lost). Gate `deals:manage`.
- `DELETE /api/deals/[id]` — gate `deals:manage`.
- `POST /api/deals/[id]/activities` — log NOTE/CALL/MEETING/TASK (TASK takes `dueAt`). Gate `deals:view`.
- `PATCH /api/deals/[id]/activities/[aid]` — toggle a TASK done. Gate `deals:view`.
- `GET /api/deals/meta` — P6 stages.

## Permissions (gate keys)

- `deals:view` — see the board/list, open deals, log activities. Gates the sidebar section + layout.
- `deals:manage` — create / edit / move / reassign / delete deals.

Seeded in `bootstrap-seed.ts` (`module: "deals"`); granted to R1 (auto), R5, R7, R3.

## Prisma models

- `Deal` + `DealActivity` (+ `DealActivityKind` enum) in `prisma/schema/deals.prisma`.
  - `Deal.pipelineId` → `Pipeline` (P6), `status` → `TicketStatus`, `assignedPositionId` → `Position` (owning seat, nullable). Deal fields: `valuePaise`, `source`, `priority` (reuses `Priority`), `nextFollowUpAt`, `closedAt`, `lostReason`, `order`. Association: `personId`/`companyId` → existing customer. **No User FKs** — `createdBy` is a `Json` `ActorSnapshot`.
  - `DealActivity.kind` = NOTE | CALL | MEETING | TASK | SYSTEM; `author` is a `Json` `ActorSnapshot`; `dueAt`/`doneAt` drive TASK follow-ups.
- Back-relation `Position.deals` (`@relation("DealPosition")`). `Pipeline.deals`/`TicketStatus.deals`/`Person.deals`/`Company.deals` stay; the `User` model has **no** Deals relations.

> Stages are configured via the existing Settings UI (`/office/settings/pipelines`). The board ignores the legacy `allowedRoles`/`notifyRoles`/`warrantyScope` columns on `TicketStatus`.

## Key components / library

- `src/modules/deals/components/`:
  - `DealsWorkspace.tsx` — container: Board/List `Tabs`, header (count + ₹ pipeline value), "New Deal" + "My deals" filter, `?new=1` deep-link, optimistic stage-move + dialogs.
  - `DealBoard.tsx` / `DealCard.tsx` — kanban; HubSpot-style deal card (title, ₹ value, priority left-accent, owner position + current holder, follow-up date with overdue red, activity count). Native HTML5 drag.
  - `DealTable.tsx` — searchable list view.
  - `DealFormDialog.tsx` — create/edit; links an existing Person/Company via `usePartySearch`; rupee text input (sanitised to paise — **no `input type=number`**), source/priority/owner-position selects, follow-up datetime-local.
  - `DealDetailDialog.tsx` — record panel: contact/association links, owner + live holders, stage move, edit/delete, **activity timeline** (note/call/meeting/task + SYSTEM) with a composer and TASK done checkbox.
- `src/modules/deals/lib/types.ts` — `DealDto`, `DealDetailDto`, `DealActivityDto`, `DealStage`, `DealActor`, `DealAssignedPosition`, `DealPositionOption`.
- `src/shared/lib/auth/actorSnapshot.ts` — `buildActorSnapshot` (shared with Administration).
- `src/shared/lib/schemas/dealSchema.ts` — Zod schemas.
- Reused: `dealsPipeline.ts` (`getDealsPipeline`/`assertDealStatus`), `usePartySearch`, `formatRupeesFromPaise`, `PRIORITY_META`, `UserAvatar`, `PathBreadcrumb`/`useEscapeBack`, `requirePermission`, `validateRequest`/`handleApiError`.

## Common workflows (wiring)

1. **Add a deal** — "New Deal" (or button-bar `?new=1`) → `POST /api/deals` → lands in "Deal"; `createdBy` snapshot captured.
2. **Move through the pipeline** — drag the card (or the Stage select) → `PATCH {status}`; SYSTEM activity logged; "Won"/"Lost" stamp `closedAt`.
3. **Own a deal** — assign to a Position; the card/detail resolve the **current holder** live, so a resignation/transfer hands the deal to the new seat-holder.
4. **Log activity / follow up** — open a deal → log a note/call/meeting, or a TASK with a due date; overdue tasks highlight; tick done.
5. **Win + link customer** — move to "Won" and link an existing Person/Company (association). No automatic sale — create the sale normally afterward.

## Recent decisions / gotchas

- **Rebuilt, not extended** — the old Deals was list+detail, User-owned, no activity/priority/follow-up. The rebuild keeps the P6 pipeline + `deals:view|manage` permissions and replaces the model mechanics + UI with the Administration-board pattern.
- **Won links, doesn't auto-sell** — keeps the protected sales/POS flow untouched.
- **Actor JSON snapshot** — `createdBy`/`author` freeze who acted (no User FK), surviving staff turnover. Built by `buildActorSnapshot`.
- **`/api/deals` returns the full P6 set** (no pagination) — fine for typical deal volumes; revisit with server-side paging if a tenant accumulates thousands.
- **quick-log** (`/api/quick-log`) still writes `Deal` rows (P2/P4/P6) with a `createdBy` snapshot — a legacy universal-intake endpoint, independent of this board.
- **Seeds** — `dummy-deals.ts` (`pnpm seed:dummy-deals`, in `seed:dummy-all`) seeds 7 demo deals across the stages with values, follow-ups, and activities, assigned to positions. `Deal`/`DealActivity` are in `hard-clean.ts` `TRANSACTION_TABLES`.

_Last updated: 2026-06-05 — Deals rebuilt as a HubSpot-style, position-owned deal pipeline: kanban board + searchable list, activity timeline (notes/calls/meetings/tasks), follow-up reminders, deal value + pipeline summary; `Position`-owned deals with JSON actor snapshots; `Deal`/`DealActivity` models, `/api/deals` CRUD + activities._
