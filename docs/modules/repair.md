# Repair (Service Tickets)

> Workflow for the repair-service line: a customer brings a device, a technician diagnoses and fixes (or escalates), the customer collects. Tickets are **info-only** — no parts list, no money. Parts and service fees are billed via normal sale vouchers with `InvVoucher.ticketId` back-link.

> ⚠️ **Access partially re-wired to Works (2026-06-11).** The role-based gates stripped on 2026-06-07 are being replaced by a **Work + permission** model. Phase 1 (done): every status/worker carries a **Work** (the `Work` model generalises the old worker groups); a *gated* Work mints a permission `work:<id>`, and setting a status/worker checks it via `passesWorkGate` ([src/modules/repairing/lib/workGate.ts](../../src/modules/repairing/lib/workGate.ts)) on `PATCH /api/tickets/[id]/worker`, `PUT /api/tickets/[id]` (status change), and `GET /api/workers/next`. The dead `allowedRoles` / `notifyRoles` / `handoffRole` columns were **dropped**. Still deferred (`requireAuth` only, `// TODO`): ticket read-scope filtering, notifications, and worker handoff auto-assign.

## URLs

### UI pages (`src/app/(protected)/office/repairing/`)
- `/office/repairing/tickets` — list locked to the Service & Repair pipeline (resolved by `REPAIR_PIPELINE_NAME = "service"` from [src/modules/repairing/lib/repairPipeline.ts](../../src/modules/repairing/lib/repairPipeline.ts)); no in-page pipeline switcher
- `/office/repairing/tickets/[id]` — detail, status changes, notes, ownership, invoices linked
- `/office/repairing/service-centers` — external repair-centre directory

### API routes
- `GET/POST /api/tickets` — list + create
- `GET/PUT /api/tickets/[id]` — detail + edit
- Sub-resources: `/api/tickets/[id]/{assign, notes, participants, reopen, worker, transfer, warranty}`
- Status / pipeline machinery: `/api/pipelines`, `/api/ticket-statuses`, `/api/workers`, `/api/worker-groups`, `/api/status-transitions`, `/api/worker-transitions`

## Permissions (gate keys)

**Currently:** none enforced inside repairing — every route requires only a logged-in staff session (`requireAuth`). The keys below are the **intended** gates to re-apply when RBAC is re-wired on Positions:

- `tickets:view:own/branch/org` — list / detail.
- `tickets:create`, `tickets:status:set`, `tickets:substatus:set`, `tickets:assign`.
- `tickets:manage-participants` — handoffs / escalations.
- `warranty:convert` — convert ticket to / from warranty job.
- `service-centers:view`, `service-centers:create`, `service-centers:edit:org`, `service-centers:delete:org`.

## Prisma models (file: `prisma/schema/tickets.prisma`)

- `Ticket` — pipelineId, status, subStatusId, customerId / companyId / accountId, deviceId, primaryOwner, billingAccount, serviceCenter, warrantyStatus, notes. Has `participants TicketParticipant[]`, `logs TicketLog[]`, **`invVouchers InvVoucher[]` (relation `TicketInvVouchers`)** — renamed from the legacy `invoices Invoice[]` relation in Layer 4 (2026-05-24) when the Invoice table was retired.
- `TicketLog` — append-only audit trail.
- `TicketParticipant` — assignees + handoff history.
- `ServiceCenter` — external repair partners.
- ~~`TicketPart`~~ — **removed Step 4 2026-05-07**. Parts billing now happens via SALE/POS `InvVoucher` rows with `InvVoucher.ticketId` back-link.

## Key components / library

- `src/modules/repairing/components/` — `StatusUpdateCombined`, `AddNoteModal`, `WarrantyBadge`, `WarrantyConvertModal`, `TicketOwnershipPanel`, `PipelineTransferModal`, **`TicketInvoicesPanel`** (replaces deleted `TicketPartsPanel`).

## Common workflows (wiring)

1. **Create ticket** — `QuickTicketButton` (2-step modal: Party -> Ticket) uses shared `PartySearchAndCreate` to search/create person/company, then POST `/api/tickets` → ticket starts at the pipeline's entry-point status.
2. **Status change** — UI `StatusUpdateCombined` → POST `/api/tickets/[id]` (or `/worker` for worker) → validates against `StatusTransition` / `SubStatusTransition` whitelist → writes `TicketLog`.
3. **Bill parts/service** — open a SALE/POS voucher → set `ticketId` on the voucher → ticket detail's `TicketInvoicesPanel` queries `GET /api/inventory/vouchers?ticketId=N&types=SALE,POS,SALE_RETURN` (Layer 3c, 2026-05-24) and lists them with `editFormUrl()` drill links.
4. **Pipeline transfer** — escalate to a different pipeline (e.g. failed repair → sales lead) via `PipelineTransferModal` → linked-tickets pattern (close origin with note, create child in target pipeline).

## Recent decisions / gotchas

- **2026-06-11 — Status/worker access re-wired to Works (Phase 1).** The dead `allowedRoles` / `notifyRoles` / `handoffRole` columns on `TicketStatus` / `TicketSubStatus` were **dropped**, and the former `SubStatusGroup` model generalised into **`Work`** (`prisma/schema/pipeline.prisma`): `id`, `label`, `color`, `order`, nullable `permissionId`. A *gated* Work (`customer_comm` / `approval` / `parts` / `qc` → `work:*` permissions) gates who may set the statuses/workers carrying it; *ungated* Works (`escalated` / `ready` / `no_fix`) stay open to any staff. Enforcement is `passesWorkGate(user, work)` (`lib/workGate.ts`), applied in the worker `PATCH`, the ticket `PUT` (on status change), and `GET /api/workers/next`. Grants are seeded in `bootstrap-seed.ts` (R1/R5/R2 hold all four; R3 holds call + quote). The assignments **Work Inbox** (`/office/work-flow-inbox`) now groups by Work, with a **My Works** tab filtered to works you hold. Notifications + handoff auto-assign remain deferred. The `/api/worker-groups` routes now operate on `Work`.
- **2026-06-07 — RBAC & notifications stripped (interim).** Repairing assumed the old single-`User.role`; under the Position model that field is null for real staff, so role-driven notifications, handoff auto-assign, and role gates silently failed. Rather than migrate piecemeal, all repairing access control was removed (open to any authenticated staff) and the notification calls detached. Status/worker notifications **do not fire** and pipeline handoff **does not auto-assign** right now. Search the repairing surface for `// TODO(rbac)` / `// TODO(notify)` for the re-wire anchor points. `notifyRoles` / `allowedRoles` / `handoffRole` columns were dropped on 2026-06-11 (superseded by the Work model — see the entry above). `buildTicketReadScopeWhere` (`lib/ticketScope.ts`) is correct, Position-based, and intact — just no longer called; re-enable it on the re-wire.
- **2026-05-07 — Tickets are info-only.** No parts, no money on the ticket. Billing flows through SALE/POS InvVouchers linked back via `InvVoucher.ticketId`. `TicketPart` model removed.
- **Pipeline / status / worker configuration** lives under [admin.md](./admin.md), not here. Reuse the existing `settings:pipelines` / `settings:statuses` permissions.
- **2026-05-10 — Tickets list is repair-only.** The pipeline switcher buttons and Pipeline column were removed from `/office/repairing/tickets`; the page resolves the "service" pipeline by name and only shows its tickets. Any `?pipeline=` URL param is ignored (the sidebar still passes `?pipeline=P1` — harmless no-op).
- **2026-05-11 — Quick Ticket party step is shared.** The "select/create customer" UI moved into `src/shared/components/PartySearchAndCreate.tsx` and supports person/company creation inline. When a person has linked companies, the ticket form exposes a "Bill To" chooser to set `billingAccountId`.
- **Linked tickets** for cross-pipeline escalation is by convention (close + create child); `parentTicketId` self-relation is in design docs but **not yet in schema** — verify before relying on it.
- **Ticket scope derives from Positions, not User M2M.** `buildTicketReadScopeWhere` filters via `primaryOwner.userPositions[].position.{branchId,departmentId}` (and the same on participants). The legacy `User.branches` / `User.departments` many-to-many relations were dropped in the 2026-05-20 Post→Position rename. A user with no Position appointment has empty `branchIds` / `departmentIds` and silently falls back to `"own"` scope — assign them a Position before expecting branch/department visibility.

## Out of scope / deferred

- Parts/inventory tracking on the ticket — moved out (Step 4).
- Pipeline / status / worker master config — see [admin.md](./admin.md).
- Repair-specific financial reporting (margin per ticket, etc.) — not built; would query InvVouchers by `ticketId`.

## Reusable helpers — DO NOT duplicate

| Symbol | File | Purpose |
|---|---|---|
| `buildTicketReadScopeWhere(user)` | `src/modules/repairing/lib/ticketScope.ts` | Build a Prisma `where` fragment that constrains tickets to what the caller's `scope` (own / branch / department / org) allows. Use in every list endpoint that returns tickets so the radius is consistent. |
| `getRepairPipeline(prisma)`, `REPAIR_PIPELINE_NAME` | `src/modules/repairing/lib/repairPipeline.ts` | Name-based resolver for the seeded Service & Repair pipeline. Use instead of hardcoding `P1`. |

_Last updated: 2026-06-11 — **Status/worker access re-wired to a Work + permission model (Phase 1).** Dropped `allowedRoles` / `notifyRoles` / `handoffRole`; generalised `SubStatusGroup` → `Work` (gated Works mint `work:*` permissions); added `passesWorkGate` enforcement to the worker `PATCH`, ticket `PUT` status change, and `workers/next`; rebuilt the assignments Work Inbox to group by Work. Previously: 2026-06-07 — **RBAC & notifications stripped from repairing (interim).** All ticket/service-centre API routes + UI pages are now open to any authenticated staff (`requireAuth` only); role/notify/handoff/scope logic removed behind `// TODO(rbac)` / `// TODO(notify)` markers, pending a Position-based re-wire. Single shared overview replaces the four role-keyed dashboards (AdminDashboard/TechnicianDashboard + HandoffPickerModal deleted). Doc fixes: corrected the UI-pages path (no `(repairing)` route group) and `/api/tickets/[id]` verb (`PUT`, not `PATCH`). Previously (2026-05-24): **Layer 3c: TicketInvoicesPanel migrated off Invoice onto InvVoucher.** `GET /api/inventory/vouchers` gained `?ticketId=N` + `?accountId=N` filters; `TicketInvoicesPanel` now queries `?ticketId=N&types=SALE,POS,SALE_RETURN` and resolves each row's edit URL via `editFormUrl()`. `Ticket.invoices Invoice[]` relation renamed to `Ticket.invVouchers InvVoucher[]` (relation `TicketInvVouchers`) when the Invoice table was retired in Layer 4. Previously (2026-05-23): noted that `buildTicketReadScopeWhere` now derives branch/department visibility from `userPositions[].position`, not the dropped `User.branches/departments` M2M (2026-05-20 Post→Position rename); date inputs in `TicketEscalation` / `WarrantyConvertModal` migrated to `TallyDateInput`._
