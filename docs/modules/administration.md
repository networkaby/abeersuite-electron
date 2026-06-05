# Administration

> Internal work board: a clean, pipeline-based todo system for management/operations work that isn't a customer repair or sale (e.g. renew trade license, file GST, hire staff, fix the showroom AC). Rides the shared `Pipeline` / `TicketStatus` infrastructure on the seeded **P4 "internal-management"** pipeline, but uses a dedicated device-free `Task` table so the repair queue stays clean. Designed DRY — other modules can adopt the `Task` model later.

## URLs

### Layout / page
- `office/administration/layout.tsx` — `makePermissionLayout(PERMISSIONS.ADMINISTRATION_TASKS_VIEW)`; redirects callers without the view permission to `/office/core/assignments`.
- `office/administration/page.tsx` — SSR shell. Loads the P4 pipeline stages (`TicketStatus where pipelineId="P4" order by order`) + the user directory + session (`currentUserId`, `canManage`), then renders the client `TaskBoard` island.

### UI page
- `/office/administration` — the kanban **Work Board** (one column per pipeline stage: Open → In Review → In Progress → On Hold → Done).

> Sidebar: the "Administration" `MODULE_SECTIONS` entry (`src/utils/constants.ts`) is gated by `administration:tasks:view`; its first child is **Work Board** → `/office/administration`. Audit log / Policies / Integrations remain roadmap placeholders under `/office/roadmap/administration/*`.

### API routes
- `GET /api/admin-tasks?pipelineId=P4` — list tasks for a pipeline (defaults to P4). Gate: `administration:tasks:view`.
- `POST /api/admin-tasks` — create a task; lands on the pipeline's entry-point stage. Gate: `administration:tasks:manage`.
- `GET /api/admin-tasks/[id]` — single task with its activity/comment thread.
- `PATCH /api/admin-tasks/[id]` — edit fields, move stage (`{ status }`), or reassign. Writes a `SYSTEM` `TaskComment` when status or assignee changes; sets `completedAt` when moved to a terminal stage. Gate: `administration:tasks:manage`.
- `DELETE /api/admin-tasks/[id]` — delete (comments cascade). Gate: `administration:tasks:manage`.
- `POST /api/admin-tasks/[id]/comments` — add a `COMMENT`. Gate: `administration:tasks:view` (any viewer may comment).

## Permissions (gate keys)

- `administration:tasks:view` — see the board, open tasks, add comments. Also gates the sidebar section + page layout.
- `administration:tasks:manage` — create / edit / assign / move / delete tasks.

Seeded in `prisma/seeds/bootstrap-seed.ts` (`module: "administration"`). Granted to R1 (Owner/Admin, auto) and R5 (Branch Manager). Add to other roles via `/office/admin/role`. Note: the env super-admin holds `admin:bypass`; seeded admins rely on the explicit grant.

## Prisma models

- `Task` and `TaskComment` (+ `TaskCommentKind` enum) in `prisma/schema/task.prisma`.
  - `Task.pipelineId` → `Pipeline`, `Task.status` → `TicketStatus` (the column it sits in), `Task.assigneeId` / `createdById` → `User`. Single assignee; `category` is a free-text tag; `priority` reuses the `Priority` enum from `tickets.prisma`; `completedAt` is set on entering a terminal stage.
  - `TaskComment.kind` = `COMMENT` (user note) | `SYSTEM` (auto status/assignee change log).
- Back-relations added to `Pipeline.tasks`, `TicketStatus.tasks`, and `User.{tasksAssigned, tasksCreated, taskComments}`.

> The pipeline stages themselves are configured via the existing Settings UI (`/office/settings/pipelines`) — see [settings.md](./settings.md). The board ignores the legacy `allowedRoles` / `notifyRoles` / `warrantyScope` columns on `TicketStatus`.

## Key components / library

- `src/modules/administration/components/`:
  - `TaskBoard.tsx` — client kanban. Fetches `/api/admin-tasks`, groups by stage, native HTML5 drag-and-drop (optimistic `PATCH { status }`, revert on error), "My tasks" toggle (assignee == current user), "New Task" button (when `canManage`).
  - `TaskCard.tsx` — title, priority badge (`PRIORITY_META`), assignee `UserAvatar`, due date (`formatDate`, red when overdue), category chip, comment count.
  - `TaskFormDialog.tsx` — shadcn `Dialog` create/edit form (title, description, category, priority, assignee, datetime-local due date).
  - `TaskDetailDialog.tsx` — fields + stage move `Select` + Edit/Delete + activity thread with add-comment box.
- `src/modules/administration/lib/types.ts` — `TaskDto`, `TaskDetailDto`, `TaskStage`, `TaskUserLite`, etc.
- `src/shared/lib/schemas/taskSchema.ts` — Zod schemas (`createTaskSchema`, `updateTaskSchema`, `createTaskCommentSchema`).
- Reused: `makePermissionLayout`, `requirePermission`, `validateRequest`, `handleApiError`, `prisma`, `PRIORITY_META` (`src/utils/constants.ts`), `UserAvatar`, `formatDate`/`formatDateTime`, `sonner` toast, `axios`.

## Common workflows (wiring)

1. **Add a task** — board "New Task" → `POST /api/admin-tasks` → lands on the entry-point stage (P4 → "Open").
2. **Move a task** — drag the card to another column (or use the Stage select in the detail dialog) → `PATCH { status }`. Optimistic on the board; a `SYSTEM` comment records the move; terminal stages stamp `completedAt`.
3. **Comment / activity** — open a card → add a comment (`POST .../comments`). System change-log entries and user comments share the `TaskComment` thread, distinguished by `kind`.
4. **Personal view** — "My tasks" toggle filters client-side to tasks assigned to the current user.

## Recent decisions / gotchas

- **Why a new `Task` table** — the repair `Ticket` model requires `deviceId` and drags in `Device`/`ServiceCenter`/warranty/billing; reusing it for internal todos would pollute the live repair queue. `Task` is device-free and rides only the generic pipeline/status tables (same pattern as `CrmLead` / `ShopOrder`).
- **Position-based access** — gating uses today's permission model (`requirePermission` over `administration:tasks:*`, resolved from `UserPosition` → `Position.roleTemplate`), not the legacy repair `allowedRoles`/`notifyRoles` arrays.
- **Free stage movement** — no `StatusTransition` graph enforcement; any stage → any stage. Can be tightened later if needed.
- **Scope** — visibility is currently org-wide for permission holders, with a client-side "My tasks" filter. Per-scope keys (`:view:own|department|branch|org`) can be added later, reusing `highestScopeFromPermissions` + a `buildTaskScopeWhere` helper modelled on `src/modules/repairing/lib/ticketScope.ts`.
- **Seeds** — `prisma/seeds/dummy-tasks.ts` (`pnpm seed:dummy-tasks`, in `seed:dummy-all`) seeds 6 demo tasks across the P4 stages. `Task` / `TaskComment` are in `hard-clean.ts` `TRANSACTION_TABLES` (transactional, not bootstrap data).
- **Drag-and-drop** — native HTML5 (`draggable` + `onDragStart`/`onDrop`), zero new dependencies. `dnd-kit` is a possible future upgrade for smoother UX.

_Last updated: 2026-06-05 — initial Administration work board (pipeline-based internal todos on P4): `Task`/`TaskComment` models, `/api/admin-tasks` CRUD + comments, kanban UI at `/office/administration`, `administration:tasks:view|manage` permissions, dummy-tasks seed._
