# CRM

> HubSpot-style deal pipeline for sales leads (device-less). Rides the shared `Pipeline` / `TicketStatus` tables on the seeded **P6 "crm-leads"** pipeline (Lead → Contacted → Qualified → Proposal Sent → Negotiation → Won / Lost). Like the Administration work board, a lead is **owned by a Position (seat)** — the current holder is resolved live via `UserPosition`, so deals transfer automatically on staff change — and the actor of an action is a **frozen JSON snapshot** (`ActorSnapshot`), not a User FK. Rebuilt 2026-06-05 from a bare list-only CRM into a kanban board + activity timeline.

## URLs

### Layout / page
- `office/crm/layout.tsx` — permission gate (`crm:view`) + `PathBreadcrumb` root "CRM" + `escapeBack` (mirrors the Administration layout).
- `office/crm/page.tsx` — SSR shell. Loads the P6 stages (via `getCrmPipeline`), the Position list (owner options), the current user's held position ids ("My leads"), then renders the client `CrmWorkspace`.

### UI page
- `/office/crm` — **CRM Pipeline** workspace: **Board** tab (kanban, one column per stage) + **List** tab (searchable table). Header shows deal count + total pipeline value.

> Sidebar: the "CRM" `MODULE_SECTIONS` entry (`src/utils/constants.ts`) is gated by `crm:view`; child **Pipeline** → `/office/crm`; `createActions` **"New Lead +"** → `/office/crm?new=1` (deep-link opens the create dialog).

### API routes
- `GET /api/crm/leads` — all P6 leads for the board (`?q=` optional search). Gate `crm:view`.
- `POST /api/crm/leads` — create on entry stage S35; `createdBy` JSON snapshot. Gate `crm:manage`.
- `GET /api/crm/leads/[id]` — detail + activity timeline.
- `PATCH /api/crm/leads/[id]` — edit / move stage (`{status}`) / reassign (`{assignedPositionId}`) / link customer / set follow-up. SYSTEM activity on stage/owner change; `closedAt` stamped on a terminal stage (Won/Lost). Gate `crm:manage`.
- `DELETE /api/crm/leads/[id]` — gate `crm:manage`.
- `POST /api/crm/leads/[id]/activities` — log NOTE/CALL/MEETING/TASK (TASK takes `dueAt`). Gate `crm:view`.
- `PATCH /api/crm/leads/[id]/activities/[aid]` — toggle a TASK done. Gate `crm:view`.
- `GET /api/crm/meta` — P6 stages.

## Permissions (gate keys)

- `crm:view` — see the board/list, open leads, log activities. Gates the sidebar section + layout.
- `crm:manage` — create / edit / move / reassign / delete leads.

Seeded in `bootstrap-seed.ts` (`module: "crm"`); granted to R1 (auto), R5, R7, R3.

## Prisma models

- `CrmLead` + `CrmLeadActivity` (+ `CrmActivityKind` enum) in `prisma/schema/crm.prisma`.
  - `CrmLead.pipelineId` → `Pipeline` (P6), `status` → `TicketStatus`, `assignedPositionId` → `Position` (owning seat, nullable). Deal fields: `valuePaise`, `source`, `priority` (reuses `Priority`), `nextFollowUpAt`, `closedAt`, `lostReason`, `order`. Association: `personId`/`companyId` → existing customer. **No User FKs** — `createdBy` is a `Json` `ActorSnapshot`.
  - `CrmLeadActivity.kind` = NOTE | CALL | MEETING | TASK | SYSTEM; `author` is a `Json` `ActorSnapshot`; `dueAt`/`doneAt` drive TASK follow-ups.
- Back-relation `Position.crmLeads` (`@relation("CrmLeadPosition")`). `Pipeline.crmLeads`/`TicketStatus.crmLeads`/`Person.crmLeads`/`Company.crmLeads` stay; the `User` model has **no** CRM relations.

> Stages are configured via the existing Settings UI (`/office/settings/pipelines`). The board ignores the legacy `allowedRoles`/`notifyRoles`/`warrantyScope` columns on `TicketStatus`.

## Key components / library

- `src/modules/crm/components/`:
  - `CrmWorkspace.tsx` — container: Board/List `Tabs`, header (count + ₹ pipeline value), "New Lead" + "My leads" filter, `?new=1` deep-link, optimistic stage-move + dialogs.
  - `LeadBoard.tsx` / `LeadCard.tsx` — kanban; HubSpot-style deal card (title, ₹ value, priority left-accent, owner position + current holder, follow-up date with overdue red, activity count). Native HTML5 drag.
  - `LeadTable.tsx` — searchable list view.
  - `LeadFormDialog.tsx` — create/edit; links an existing Person/Company via `usePartySearch`; rupee text input (sanitised to paise — **no `input type=number`**), source/priority/owner-position selects, follow-up datetime-local.
  - `LeadDetailDialog.tsx` — record panel: contact/association links, owner + live holders, stage move, edit/delete, **activity timeline** (note/call/meeting/task + SYSTEM) with a composer and TASK done checkbox.
- `src/modules/crm/lib/types.ts` — `LeadDto`, `LeadDetailDto`, `LeadActivityDto`, `LeadStage`, `LeadActor`, `LeadAssignedPosition`, `LeadPositionOption`.
- `src/shared/lib/auth/actorSnapshot.ts` — `buildActorSnapshot` (shared with Administration).
- `src/shared/lib/schemas/crmSchema.ts` — Zod schemas.
- Reused: `crmPipeline.ts` (`getCrmPipeline`/`assertCrmStatus`), `usePartySearch`, `formatRupeesFromPaise`, `PRIORITY_META`, `UserAvatar`, `PathBreadcrumb`/`useEscapeBack`, `requirePermission`, `validateRequest`/`handleApiError`.

## Common workflows (wiring)

1. **Add a lead** — "New Lead" (or button-bar `?new=1`) → `POST /api/crm/leads` → lands in "Lead"; `createdBy` snapshot captured.
2. **Move through the pipeline** — drag the card (or the Stage select) → `PATCH {status}`; SYSTEM activity logged; "Won"/"Lost" stamp `closedAt`.
3. **Own a deal** — assign to a Position; the card/detail resolve the **current holder** live, so a resignation/transfer hands the deal to the new seat-holder.
4. **Log activity / follow up** — open a lead → log a note/call/meeting, or a TASK with a due date; overdue tasks highlight; tick done.
5. **Win + link customer** — move to "Won" and link an existing Person/Company (association). No automatic sale — create the sale normally afterward.

## Recent decisions / gotchas

- **Rebuilt, not extended** — the old CRM was list+detail, User-owned, no activity/priority/follow-up. The rebuild keeps the P6 pipeline + `crm:view|manage` permissions and replaces the model mechanics + UI with the Administration-board pattern.
- **Won links, doesn't auto-sell** — keeps the protected sales/POS flow untouched.
- **Actor JSON snapshot** — `createdBy`/`author` freeze who acted (no User FK), surviving staff turnover. Built by `buildActorSnapshot`.
- **`/api/crm/leads` returns the full P6 set** (no pagination) — fine for typical lead volumes; revisit with server-side paging if a tenant accumulates thousands.
- **quick-log** (`/api/quick-log`) still writes `CrmLead` rows (P2/P4/P6) with a `createdBy` snapshot — a legacy universal-intake endpoint, independent of this board.
- **Seeds** — `dummy-crm-leads.ts` (`pnpm seed:dummy-crm-leads`, in `seed:dummy-all`) seeds 7 demo deals across the stages with values, follow-ups, and activities, assigned to positions. `CrmLead`/`CrmLeadActivity` are in `hard-clean.ts` `TRANSACTION_TABLES`.

_Last updated: 2026-06-05 — CRM rebuilt as a HubSpot-style, position-owned deal pipeline: kanban board + searchable list, activity timeline (notes/calls/meetings/tasks), follow-up reminders, deal value + pipeline summary; `Position`-owned leads with JSON actor snapshots; `CrmLead`/`CrmLeadActivity` models, `/api/crm/leads` CRUD + activities._
