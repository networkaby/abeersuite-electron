# Admin

> Org-shape and RBAC: users, roles + permissions, branches, departments, positions, org-chart, POS counters. Configuration concerns (pipelines, statuses, org-defaults, year-ending, naming-convention, printer-settings) were carved out into the [Settings module](./settings.md) on 2026-05-20.

## URLs

### UI pages (all inside `office/admin/` — real URL segments, no route groups)
- `/office/admin/users` — `office/admin/users/{layout,page}.tsx`
- `/office/admin/role` — Roles UI (the **Enterprise Permission Matrix** lives here)
- `/office/admin/branches`, `/office/admin/departments`, `/office/admin/positions`
- `/office/admin/org-chart` — visual hierarchy
- `/office/admin/counters` — POS counter management (see [pos.md](./pos.md))

> 2026-05-11: route groups `(admin)`, `(core)`, `(message)`, `(roadmap)`, `(social)` were promoted to real URL segments. Sub-paths now carry their module prefix (e.g. `/office/branches` → `/office/admin/branches`, `/office/users` → `/office/admin/users`, profile pages `/office/users/[id]` → `/office/social/users/[id]`).

> 2026-05-20: pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings moved out to `/office/settings/*`. See [settings.md](./settings.md). Hard cut — no `/office/admin/<page>` → `/office/settings/<page>` redirects.

> 2026-05-20: org-chart `Post` model renamed to `Position` (and `UserPost` → `UserPosition`). UI moved from `/office/admin/posts` to `/office/admin/positions`; API moved from `/api/posts` to `/api/positions`. The deprecated `User.branches` / `User.departments` many-to-many relations were dropped at the same time — branches/departments a user belongs to are now derived purely from their Position assignments.

### API routes
- `/api/users[/[id]]` — user CRUD.
- `/api/roles[/[id]]` — role + permission grant matrix endpoints.
- `/api/permissions` — list of all defined permission IDs (read-only; source of truth is `prisma/seeds/bootstrap-seed.ts`).
- `/api/branches`, `/api/departments`, `/api/positions`, `/api/positions/[id]/holders`, `/api/positions/structure` — org structure.
- `/api/org-chart` — user reporting-line tree (consumed by org-chart page and social profile wall).

> Pipeline / status / org-defaults APIs live in [settings.md](./settings.md). They were not renamed — only the UI moved.

## Permissions (gate keys)

- `admin:bypass` — master key, passes every check.
- `users:manage` (legacy) + `users:create`, `users:edit:org`, `users:delete:org`.
- `roles:manage` (legacy) + `roles:create`, `roles:edit:org`, `roles:delete:org`.
- `settings:manage` — branches / departments / positions (also used by the Settings module for org-defaults / year-ending / printer-settings).
- `inventory:manage` (lives here in seed `module: admin`, even though it gates inventory pages).
- `ecommerce:manage`.

> `settings:statuses*` and `settings:pipelines*` are documented in [settings.md](./settings.md) since they gate UI that now lives there.

## Prisma models

- `User`, `Role`, `Permission`, `RolePermission`, `UserPermission` (in `prisma/schema/users.prisma`).
- `Branch`, `Department`, `Position`, `UserPosition` (org-shape, in `prisma/schema/org.prisma`).

> `OrgDefaults`, `Pipeline`, `TicketStatus`, `TicketSubStatus`, `SubStatusGroup`, `StatusTransition`, `SubStatusTransition` are documented in [settings.md](./settings.md).

## Key components / library

> `OrgDefaultsForm` now lives in [settings.md](./settings.md) (`src/modules/settings/components/OrgDefaultsForm.tsx`).

- **Org chart tab views** (`/office/admin/org-chart` — 6 tabs):
  - `OrgTree.tsx` — Tab 1 "People Chart": reporting-line tree powered by `/api/org-chart` (`OrgNode[]`).
  - `StructureTree.tsx` — Tab 2 "Structure Chart": 4-level CSS-connector hierarchy (Executive Council → Branch → Dept → Position) built from `OrgStructure`. Renders `PositionCard`, `DeptGroup`, `BranchNode`, `OrgWideRow` with `VLine`/`HBar` primitives.
  - `OrgExplorer.tsx` — Tab 3 "Explorer (beta)": dashboard-style search + branch-filter chips + hover/pin detail panel.
  - `OrgHierarchy.tsx` — Tab 4 "Hierarchy (beta)": top-down tree rooted at Board; click-to-highlight lineage path; collapse/expand nodes; zoom controls.
  - `OrgLevels.tsx` — Tab 5 "Levels (beta)": classic level-based view — L1 Board (gold), L2 Branches (blue), L3 Departments (green), L4 Positions (purple); dark canvas with staggered `orgLevelFadeUp` animations.
  - `OrgRegions.tsx` — Tab 6 "Regions (beta)": HQ container (amber) + regional branch cards (emerald); `HQ_BRANCH_ID = "BR-HQ"` sentinel separates HQ from regional branches; positions auto-classified by title regex into Board / Chief Executive / C-Level / Central Departments sections.
- `src/shared/types/orgChart.ts` — shared types for all org-chart views:
  - `OrgNode` — reporting-line node (used by OrgTree / `/api/org-chart`). `branches`/`departments` arrays are derived from the user's Positions inside the route handler.
  - `PositionNode` — position + holders shape (used by StructureTree / Explorer / Hierarchy / Levels / Regions).
  - `DeptGroup { dept; positions }`, `BranchGroup { branch; deptGroups }`, `OrgStructure { orgWidePositions; branches }` — grouped structure shape returned by `/api/positions/structure` and consumed by Tabs 2-6.
- `src/shared/lib/auth/permissions.ts` — `requireAuth`, `requirePermission`, `requireRole`, `hasPermission`.
- `src/shared/lib/auth/permissionScope.ts` — `hasPermissionWithScope` (handles `area:op:scope` lookup with widening).
- `src/shared/lib/auth/makePermissionLayout.tsx` — `makePermissionLayout(permission)` — used by every `office/admin/<page>/layout.tsx`.
- `src/shared/lib/auth/authorizeStaff.ts` — login-time resolver. Derives `branchIds` and `departmentIds` from the user's `UserPosition[]` (org-wide positions grant access to every branch / every department).
- `prisma/seeds/bootstrap-seed.ts` — single source of truth for permission IDs + role grants. Reseed (`pnpm prisma db seed`) is required to add new permissions.

## Common workflows (wiring)

1. **Add a new permission ID** — edit `PERMISSIONS` array in `prisma/seeds/bootstrap-seed.ts` → run `pnpm prisma db seed` → user opens `/office/admin/role` and ticks the new row for relevant roles.
2. **Assign role to user** — `/office/admin/users/[id]` updates the user's identity fields (name, email, etc.). Operational role + branch + department all flow from the Positions the user holds; appoint them on `/office/admin/positions`.
3. **Org chart structure** — `/api/positions/structure` returns `OrgStructure` (not a flat list). It groups every `Position` as: `branchId == null` → `orgWidePositions`; otherwise bucketed into `branches[].deptGroups[]`. Tabs 2-6 all consume this single endpoint. The People Chart tab (Tab 1) uses the separate `/api/org-chart` endpoint which returns `OrgNode[]` (parent/child reporting-line tree).
4. **Branch/Department delete guards** — `/api/branches/[id]` DELETE blocks if any Position or Department is still attached; `/api/departments/[id]` DELETE blocks if any Position is still attached. `/api/positions/[id]` DELETE blocks on `children > 0` or `holders > 0`. All three return a 400 with a clear "reassign first" message; no silent orphaning.

## Recent decisions / gotchas

- **2026-05-07 (Step 0)**: 4 demo users seeded with predictable passwords — see the demo-logins table in [seeds.md](../seeds.md) and the role catalogue in [permissions.md](./permissions.md).
- **2026-05-07 (Step 0)**: 10 new `accountancy:*` permission rows added. Admin (R1) gets them via `PERMISSIONS.map(p => p.id)`. Non-admin roles need explicit grant via the matrix.
- **2026-05-07 (Step 2)**: Pipelines / statuses / sub-statuses moved from Repair settings to Admin (`/office/admin/pipelines` etc.).
- **2026-05-19 (V1 complete)**: Admin module marked done in [completed-and-protected.md](../completed-and-protected.md). Treat permission matrix, user CRUD, org-shape masters, and pipeline/status machinery as preserve-first unless explicitly requested.
- **2026-05-20 — Settings extracted.** Pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings moved out to `/office/settings/*`; `OrgDefaultsForm` moved to `src/modules/settings/components/`. See [settings.md](./settings.md). Admin keeps users, roles, branches, departments, positions, org-chart, counters.
- **2026-05-20 — Position rename + M2M drop.** `Post` → `Position`, `UserPost` → `UserPosition` (table rename via `prisma db push`, prior data dropped). Deprecated `User.branches` / `User.departments` many-to-many relations removed; admin no longer assigns branches/departments directly on a user — those access lists are derived from the user's Position assignments. Delete guards on `/api/branches/[id]`, `/api/departments/[id]`, and `/api/positions/[id]` were rewritten to count Position-derived relations (previously counted the empty M2M and silently orphaned children).
- **2026-05-19 — Org chart restructure**: `/api/positions/structure` was rewritten from a `parentPositionId`-based flat tree to a `branch → dept` grouping (`OrgStructure`). `parentPositionId` is still stored in the schema but is no longer the primary rendering axis.
- **2026-05-19 — Rich demo seed**: `prisma/seeds/dummy-org-rich.ts` (`pnpm seed:dummy-org-rich`) creates 36 users, 36 positions, 5 branches (HQ + 4 regional), 10 departments matching a realistic company org chart. `HQ_BRANCH_ID = "BR-HQ"` is the sentinel used by `OrgRegions` to separate HQ from regional branches.
- **Future scope tier `position`** (between `own` and `department`) is planned but **not yet in code**. `permission-scope.ts` order is currently `own → department → branch → org`.

## Out of scope / deferred

- A "permissions UI" that adds new permission rows from the app — does not exist; reseed is required.
- A `permissions:edit` permission gate — no, since changes happen via seed file edits + reseed, not at runtime.

_Last updated: 2026-05-20 — Renamed Post → Position across schema/API/UI/seeds; dropped deprecated User.branches and User.departments M2M; rewrote delete guards on branches/departments/positions to use the live Position-derived counts._
