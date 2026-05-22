# Repair (Service Tickets)

> Workflow for the repair-service line: a customer brings a device, a technician diagnoses and fixes (or escalates), the customer collects. Tickets are **info-only** — no parts list, no money. Parts and service fees are billed via normal Invoices with `Invoice.ticketId` back-link.

## URLs

### UI pages (`src/app/(protected)/office/(repairing)/repairing/`)
- `/office/repairing/tickets` — list locked to the Service & Repair pipeline (resolved by `REPAIR_PIPELINE_NAME = "service"` from [src/modules/repairing/lib/repairPipeline.ts](../../src/modules/repairing/lib/repairPipeline.ts)); no in-page pipeline switcher
- `/office/repairing/tickets/[id]` — detail, status changes, notes, ownership, invoices linked
- `/office/repairing/service-centers` — external repair-centre directory

### API routes
- `GET/POST /api/tickets` — list + create
- `GET/PATCH /api/tickets/[id]` — detail + edit
- Sub-resources: `/api/tickets/[id]/{assign, notes, participants, reopen, sub-status, transfer, warranty}`
- Status / pipeline machinery: `/api/pipelines`, `/api/ticket-statuses`, `/api/sub-statuses`, `/api/sub-status-groups`, `/api/status-transitions`, `/api/sub-status-transitions`

## Permissions (gate keys)

- `tickets:view:own/branch/org` — list / detail.
- `tickets:create`, `tickets:status:set`, `tickets:substatus:set`, `tickets:assign`.
- `tickets:manage-participants` — handoffs / escalations.
- `warranty:convert` — convert ticket to / from warranty job.
- `service-centers:view`, `service-centers:create`, `service-centers:edit:org`, `service-centers:delete:org`.

## Prisma models (file: `prisma/schema/tickets.prisma`)

- `Ticket` — pipelineId, status, subStatusId, customerId / companyId / accountId, deviceId, primaryOwner, billingAccount, serviceCenter, warrantyStatus, notes. Has `participants TicketParticipant[]`, `logs TicketLog[]`, **`invoices Invoice[]` (relation `TicketInvoices`)** — added Step 4 2026-05-07.
- `TicketLog` — append-only audit trail.
- `TicketParticipant` — assignees + handoff history.
- `ServiceCenter` — external repair partners.
- ~~`TicketPart`~~ — **removed Step 4 2026-05-07**. Parts billing now happens via `Invoice` lines with `Invoice.ticketId` back-link.

## Key components / library

- `src/modules/repairing/components/` — `StatusUpdateCombined`, `AddNoteModal`, `WarrantyBadge`, `WarrantyConvertModal`, `TicketOwnershipPanel`, `PipelineTransferModal`, **`TicketInvoicesPanel`** (replaces deleted `TicketPartsPanel`).

## Common workflows (wiring)

1. **Create ticket** — `QuickTicketButton` (2-step modal: Party -> Ticket) uses shared `PartySearchAndCreate` to search/create person/company, then POST `/api/tickets` → ticket starts at the pipeline's entry-point status.
2. **Status change** — UI `StatusUpdateCombined` → POST `/api/tickets/[id]` (or `/sub-status` for sub-status) → validates against `StatusTransition` / `SubStatusTransition` whitelist → writes `TicketLog`.
3. **Bill parts/service** — open Invoice via Accountancy → set `ticketId` on the invoice → ticket detail's `TicketInvoicesPanel` queries `/api/accountancy/invoices?ticketId=N` and lists them. **Pending DB migration** for `ticketId` to actually exist on Invoice.
4. **Pipeline transfer** — escalate to a different pipeline (e.g. failed repair → sales lead) via `PipelineTransferModal` → linked-tickets pattern (close origin with note, create child in target pipeline).

## Recent decisions / gotchas

- **2026-05-07 — Tickets are info-only.** No parts, no money on the ticket. Billing flows through Accountancy invoices linked back via `Invoice.ticketId`. `TicketPart` model removed.
- **Pipeline / status / sub-status configuration** lives under [admin.md](./admin.md), not here. Reuse the existing `settings:pipelines` / `settings:statuses` permissions.
- **2026-05-10 — Tickets list is repair-only.** The pipeline switcher buttons and Pipeline column were removed from `/office/repairing/tickets`; the page resolves the "service" pipeline by name and only shows its tickets. Any `?pipeline=` URL param is ignored (the sidebar still passes `?pipeline=P1` — harmless no-op).
- **2026-05-11 — Quick Ticket party step is shared.** The "select/create customer" UI moved into `src/shared/components/PartySearchAndCreate.tsx` and supports person/company creation inline. When a person has linked companies, the ticket form exposes a "Bill To" chooser to set `billingAccountId`.
- **Linked tickets** for cross-pipeline escalation is by convention (close + create child); `parentTicketId` self-relation is in design docs but **not yet in schema** — verify before relying on it.
- **Ticket scope derives from Positions, not User M2M.** `buildTicketReadScopeWhere` filters via `primaryOwner.userPositions[].position.{branchId,departmentId}` (and the same on participants). The legacy `User.branches` / `User.departments` many-to-many relations were dropped in the 2026-05-20 Post→Position rename. A user with no Position appointment has empty `branchIds` / `departmentIds` and silently falls back to `"own"` scope — assign them a Position before expecting branch/department visibility.

## Out of scope / deferred

- Parts/inventory tracking on the ticket — moved out (Step 4).
- Pipeline / status / sub-status master config — see [admin.md](./admin.md).
- Repair-specific financial reporting (margin per ticket, etc.) — not built; would query Invoices by `ticketId`.

## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|---|---|---|
| `buildTicketReadScopeWhere(user)` | `src/modules/repairing/lib/ticketScope.ts` | Build a Prisma `where` fragment that constrains tickets to what the caller's `scope` (own / branch / department / org) allows. Use in every list endpoint that returns tickets so the radius is consistent. |
| `getRepairPipeline(prisma)`, `REPAIR_PIPELINE_NAME` | `src/modules/repairing/lib/repairPipeline.ts` | Name-based resolver for the seeded Service & Repair pipeline. Use instead of hardcoding `P1`. |

_Last updated: 2026-05-23 — noted that `buildTicketReadScopeWhere` now derives branch/department visibility from `userPositions[].position`, not the dropped `User.branches/departments` M2M (2026-05-20 Post→Position rename); date inputs in `TicketEscalation` / `WarrantyConvertModal` migrated to `TallyDateInput`._
