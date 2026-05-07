# Admin (Settings)

> Org-shape configuration: users, roles + permissions, branches, departments, posts, pipelines, ticket statuses, sub-statuses. Sidebar labels this section "Settings" (NOT "Administration") to match the matrix terminology.

## URLs

### UI pages (all inside `(admin)` route group, root-level paths)
- `/office/users` — `(admin)/users/{layout,page}.tsx`
- `/office/role` — Roles UI (the **Enterprise Permission Matrix** lives here)
- `/office/branches`, `/office/departments`, `/office/posts`
- `/office/org-chart` — visual hierarchy
- `/office/pipelines` — pipeline master (moved from `/office/repairing/settings/pipelines` Step 2 2026-05-07)
- `/office/statuses` — ticket statuses
- `/office/sub-statuses` — ticket sub-statuses (with sub-status groups)

Compatibility redirects in `next.config.ts`: `/office/repairing/settings/pipelines/*` and `/office/settings/pipelines` both 307 to `/office/pipelines`. Same for statuses and sub-statuses.

### API routes
- `/api/users[/[id]]` — user CRUD.
- `/api/roles[/[id]]` — role + permission grant matrix endpoints.
- `/api/permissions` — list of all defined permission IDs (read-only; source of truth is `src/new-seed.ts`).
- `/api/branches`, `/api/departments`, `/api/posts`, `/api/posts/[id]/holders` — org structure.
- `/api/pipelines[/[id]]`, `/api/ticket-statuses[/[id]]`, `/api/sub-statuses[/[id]]`, `/api/sub-status-groups[/[id]]`, `/api/status-transitions[/[id]]`, `/api/sub-status-transitions[/[id]]` — pipeline machinery (these stay where they are even though the UI moved).

## Permissions (gate keys)

- `admin:bypass` — master key, passes every check.
- `users:manage` (legacy) + `users:create`, `users:edit:org`, `users:delete:org`.
- `roles:manage` (legacy) + `roles:create`, `roles:edit:org`, `roles:delete:org`.
- `settings:manage` — branches / departments / posts.
- `settings:statuses` (legacy) + `settings:statuses:create`, `settings:statuses:edit`, `settings:statuses:delete`.
- `settings:pipelines` (legacy) + `settings:pipelines:create`, `settings:pipelines:edit`, `settings:pipelines:delete`.
- `inventory:manage` (lives here in seed `module: admin`, even though it gates inventory pages).
- `ecommerce:manage`.

## Prisma models

- `User`, `Role`, `Permission`, `RolePermission`, `UserPermission` (in `prisma/schema/users.prisma`).
- `Branch`, `Department`, `Post`, `PostHolder` (org-shape).
- `Pipeline`, `TicketStatus`, `TicketSubStatus`, `SubStatusGroup`, `StatusTransition`, `SubStatusTransition` (in `prisma/schema/pipeline.prisma`).

## Key components / library

- `src/lib/auth-guard.ts` — `requireAuth`, `requirePermission`, `requireRole`, `hasPermission`.
- `src/lib/permission-scope.ts` — `hasPermissionWithScope` (handles `area:op:scope` lookup with widening).
- `src/lib/make-permission-layout.tsx` — `makePermissionLayout(permission)` — used by every `(admin)/<page>/layout.tsx`.
- `src/lib/permissions.ts` — UI helpers.
- `src/new-seed.ts` — single source of truth for permission IDs + role grants. Reseed (`pnpm prisma db seed`) is required to add new permissions.

## Common workflows (wiring)

1. **Add a new permission ID** — edit `PERMISSIONS` array in `src/new-seed.ts` → run `pnpm prisma db seed` → user opens `/office/role` and ticks the new row for relevant roles.
2. **Create / edit a pipeline** — `/office/pipelines` → calls `/api/pipelines[/[id]]` → ButtonBar reflects new pipeline immediately for users with appropriate role grants.
3. **Assign role to user** — `/office/users/[id]` → updates user's `role` field (R1 Admin / R2 Tech / R3 Front Desk / R4 Despatch).

## Recent decisions / gotchas

- **2026-05-07 (Step 0)**: 4 demo users seeded with predictable passwords — see [permission_matrix memory](../../memory/permission_matrix.md) for the table.
- **2026-05-07 (Step 0)**: 10 new `accountancy:*` permission rows added. Admin (R1) gets them via `PERMISSIONS.map(p => p.id)`. Non-admin roles need explicit grant via the matrix.
- **2026-05-07 (Step 2)**: Pipelines / statuses / sub-statuses moved from Repair settings to Admin. URLs are `/office/pipelines` etc. (not `/office/admin/pipelines`) because the existing admin convention uses route groups, not URL prefixes.
- **Future scope tier `post`** (between `own` and `department`) is planned but **not yet in code**. `permission-scope.ts` order is currently `own → department → branch → org`.

## Out of scope / deferred

- A "permissions UI" that adds new permission rows from the app — does not exist; reseed is required.
- A `permissions:edit` permission gate — no, since changes happen via seed file edits + reseed, not at runtime.

_Last updated: 2026-05-07 — covers state after Step 0 + Step 2._
