# Administration

> Internal work board: a clean, pipeline-based todo system for management/operations work that isn't a customer repair or sale (e.g. renew trade license, file GST, hire staff, fix the showroom AC). Rides the shared `Pipeline` / `TicketStatus` infrastructure on the seeded **P4 "internal-management"** pipeline, but uses a dedicated device-free `Task` table so the repair queue stays clean. **Tasks are owned by a Position (seat), not a user** — whoever currently holds that position is the effective owner, so work transfers automatically when staff resign or move branch. Designed DRY — other modules can adopt the `Task` model later.

## URLs

### Layout / page
- `office/administration/layout.tsx` — async server layout: inline permission gate (redirects callers without `administration:tasks:view` to `/office/work-flow-inbox`) + `PathBreadcrumb` rooted at "Administration" with `escapeBack` (Esc → `router.back()`, guarded against open dialogs via `useEscapeBack`).
- `office/administration/page.tsx` — SSR shell. Loads the P4 pipeline stages (`TicketStatus where pipelineId="P4" order by order`), the **Position list** (assignee options), and the current user's **held position ids** (`UserPosition`, drives "My tasks"), then renders the client `TaskBoard` island.

### UI page
- `/office/administration` — the kanban **Work Board** (one column per pipeline stage: Open → In Review → In Progress → On Hold → Done).

> Sidebar: the "Administration" `MODULE_SECTIONS` entry (`src/utils/constants.ts`) is gated by `administration:tasks:view`; its first child is **Work Board** → `/office/administration`. It also carries a `createActions` **"New Task +"** entry (gated by `administration:tasks:manage`) that deep-links to `/office/administration?new=1` — the board opens the create dialog on that param, then strips it. Audit log / Policies / Integrations remain roadmap placeholders.

### API routes
- `GET /api/admin-tasks?pipelineId=P4` — list tasks for a pipeline (defaults to P4). Gate: `administration:tasks:view`.
- `POST /api/admin-tasks` — create a task; lands on the pipeline's entry-point stage. Gate: `administration:tasks:manage`.
- `GET /api/admin-tasks/[id]` — single task with its activity/comment thread.
- `PATCH /api/admin-tasks/[id]` — edit fields, move stage (`{ status }`), or reassign (`{ assignedPositionId }`). Writes a `SYSTEM` `TaskComment` when status or assigned position changes; sets `completedAt` when moved to a terminal stage. Gate: `administration:tasks:manage`.
- `DELETE /api/admin-tasks/[id]` — delete (comments cascade). Gate: `administration:tasks:manage`.
- `POST /api/admin-tasks/[id]/comments` — add a `COMMENT`. Gate: `administration:tasks:view` (any viewer may comment).

## Permissions (gate keys)

- `administration:tasks:view` — see the board, open tasks, add comments. Also gates the sidebar section + page layout.
- `administration:tasks:manage` — create / edit / assign / move / delete tasks.

Seeded in `prisma/seeds/bootstrap-seed.ts` (`module: "administration"`). Granted to R1 (Owner/Admin, auto) and R5 (Branch Manager). Add to other roles via `/office/admin/role`. Note: the env super-admin holds `admin:bypass`; seeded admins rely on the explicit grant.

## Prisma models

- `Task` and `TaskComment` (+ `TaskCommentKind` enum) in `prisma/schema/task.prisma`.
  - `Task.pipelineId` → `Pipeline`, `Task.status` → `TicketStatus` (the column it sits in), `Task.assignedPositionId` → `Position` (the owning **seat**, nullable). `category` is a free-text tag; `priority` reuses the `Priority` enum from `tickets.prisma`; `completedAt` is set on entering a terminal stage.
  - **No User FKs.** The actor of an action is captured as a frozen JSON snapshot — `Task.createdBy` and `TaskComment.author` (`Json`, shape `TaskActor` = `{ userId, userName, avatarUrl, positionId, positionTitle }`) — so audit history survives staff turnover. The **current** owner is resolved live from `assignedPosition.holders` (`UserPosition`).
  - `TaskComment.kind` = `COMMENT` (user note) | `SYSTEM` (auto status/assignment change log).
- Back-relation added to `Position.tasks` (`@relation("TaskAssignedPosition")`). `Pipeline.tasks` / `TicketStatus.tasks` stay; the `User` model has **no** task relations.

> The pipeline stages themselves are configured via the existing Settings UI (`/office/settings/pipelines`) — see [settings.md](./settings.md). The board ignores the legacy `allowedRoles` / `notifyRoles` / `warrantyScope` columns on `TicketStatus`.

## Key components / library

- `src/modules/administration/components/`:
  - `TaskBoard.tsx` — client kanban. Fetches `/api/admin-tasks`, groups by stage, native HTML5 drag-and-drop (optimistic `PATCH { status }`, revert on error), "My tasks" toggle (tasks whose `assignedPositionId` ∈ the user's held positions), "New Task" button (when `canManage`). Also opens the create dialog on the `?new=1` deep-link from the button bar.
  - `TaskCard.tsx` — title, priority badge (`PRIORITY_META`) + left-accent, the assigned **position title** with its **current holder** (`UserAvatar`, "Vacant"/"+N" when 0/many holders), due date (`formatDate`, red when overdue), category chip, comment count.
  - `TaskFormDialog.tsx` — shadcn `Dialog` create/edit form (title, description, category, priority, **assign-to-position** `Select`, datetime-local due date).
  - `TaskDetailDialog.tsx` — fields, the assigned position + branch/department + live holder chips, created-by snapshot, stage move `Select`, Edit/Delete, activity thread with add-comment box.
- `src/modules/administration/lib/types.ts` — `TaskDto`, `TaskDetailDto`, `TaskStage`, `TaskActor`, `TaskAssignedPosition`, `TaskPositionOption`, `TaskPositionHolder`.
- `src/modules/administration/lib/taskActor.ts` — `buildTaskActor(userId)`: server-only helper that builds the JSON actor snapshot (name + first position) for `createdBy` / `author`.
- `src/shared/lib/schemas/taskSchema.ts` — Zod schemas (`createTaskSchema`, `updateTaskSchema`, `createTaskCommentSchema`); assignment field is `assignedPositionId` (string).
- Reused: `requirePermission`, `validateRequest`, `handleApiError`, `prisma`, `PRIORITY_META` (`src/utils/constants.ts`), `UserAvatar`, `formatDate`/`formatDateTime`, `PathBreadcrumb` + `useEscapeBack`, `sonner` toast, `axios`.

## Common workflows (wiring)

1. **Add a task** — board "New Task" (or the button-bar "New Task +") → `POST /api/admin-tasks` → lands on the entry-point stage (P4 → "Open"); `createdBy` JSON snapshot captured from the session user.
2. **Move a task** — drag the card to another column (or use the Stage select in the detail dialog) → `PATCH { status }`. Optimistic on the board; a `SYSTEM` comment records the move; terminal stages stamp `completedAt`.
3. **Assign to a seat** — pick a Position in the form / detail dialog → `PATCH { assignedPositionId }`. A `SYSTEM` comment logs the change. The card/detail resolve the **current holder(s)** live from `UserPosition`, so a later resignation/transfer silently hands the task to the new holder.
4. **Comment / activity** — open a card → add a comment (`POST .../comments`). System change-log entries and user comments share the `TaskComment` thread, distinguished by `kind`; both store the actor as a JSON snapshot.
5. **Personal view** — "My tasks" toggle filters client-side to tasks assigned to a position the current user holds.

## Recent decisions / gotchas

- **Why a new `Task` table** — the repair `Ticket` model requires `deviceId` and drags in `Device`/`ServiceCenter`/warranty/billing; reusing it for internal todos would pollute the live repair queue. `Task` is device-free and rides only the generic pipeline/status tables (same pattern as `CrmLead` / `ShopOrder`).
- **Ownership = Position, not User** — a task is assigned to a *seat* (`assignedPositionId` → `Position`); the effective owner is whoever currently holds it (`UserPosition`). This matches the position-based RBAC (roles attach to positions) and means open work transfers automatically when staff resign or change branch — no manual reassignment. Permission gating likewise resolves from `UserPosition` → `Position.roleTemplate`.
- **Actor as JSON snapshot** — `Task.createdBy` / `TaskComment.author` are `Json` (`TaskActor`), not User FKs, so "who did this" history is frozen and survives staff turnover. Built server-side by `buildTaskActor` (`src/modules/administration/lib/taskActor.ts`). Trade-off: snapshots don't auto-update if a person renames — intentional for an audit trail.
- **Free stage movement** — no `StatusTransition` graph enforcement; any stage → any stage. Can be tightened later if needed.
- **Scope** — visibility is currently org-wide for permission holders, with a client-side "My tasks" filter (by held positions). Per-scope keys (`:view:own|department|branch|org`) can be added later, reusing `highestScopeFromPermissions` + a `buildTaskScopeWhere` helper modelled on `src/modules/repairing/lib/ticketScope.ts`.
- **Seeds** — `prisma/seeds/dummy-tasks.ts` (`pnpm seed:dummy-tasks`, in `seed:dummy-all`) seeds 6 demo tasks across the P4 stages, assigned round-robin to existing positions with an admin `createdBy` snapshot. `Task` / `TaskComment` are in `hard-clean.ts` `TRANSACTION_TABLES` (transactional, not bootstrap data).
- **Drag-and-drop** — native HTML5 (`draggable` + `onDragStart`/`onDrop`), zero new dependencies. `dnd-kit` is a possible future upgrade for smoother UX.

_Last updated: 2026-06-05 — Administration work board, position-based ownership: tasks assigned to a `Position` (current holder resolved live), actor captured as a JSON snapshot (`createdBy`/`author`, no User FK); `/api/admin-tasks` CRUD + comments, kanban UI at `/office/administration`, breadcrumb + Esc-back layout, button-bar "New Task" action, `administration:tasks:view|manage`._
