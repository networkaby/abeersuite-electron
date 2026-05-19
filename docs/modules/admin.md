# Admin (Settings)

> Org-shape configuration: users, roles + permissions, branches, departments, posts, pipelines, ticket statuses, sub-statuses. Sidebar labels this section "Settings" (NOT "Administration") to match the matrix terminology.

## URLs

### UI pages (all inside `office/admin/` — real URL segments, no route groups)
- `/office/admin/users` — `office/admin/users/{layout,page}.tsx`
- `/office/admin/role` — Roles UI (the **Enterprise Permission Matrix** lives here)
- `/office/admin/branches`, `/office/admin/departments`, `/office/admin/posts`
- `/office/admin/org-chart` — visual hierarchy
- `/office/admin/pipelines` — pipeline master (moved from `/office/repairing/settings/pipelines` Step 2 2026-05-07)
- `/office/admin/statuses` — ticket statuses
- `/office/admin/sub-statuses` — ticket sub-statuses (with sub-status groups)
- `/office/admin/org-defaults` — org-wide defaults (unit, GST, HSN, taxability, payment terms, currency)
- `/office/admin/year-ending` — financial year close + opening balance setup
- `/office/admin/counters` — POS counter management (see [pos.md](./pos.md))
- `/office/admin/naming-convention` — product name / online name / slug auto-generation (see [inventory.md](./inventory.md))
- `/office/admin/printer-settings` — thermal printer config for POS + voucher print fallback

> 2026-05-11: route groups `(admin)`, `(core)`, `(message)`, `(roadmap)`, `(social)` were promoted to real URL segments. Sub-paths now carry their module prefix (e.g. `/office/branches` → `/office/admin/branches`, `/office/users` → `/office/admin/users`, profile pages `/office/users/[id]` → `/office/social/users/[id]`).

Compatibility redirects in `next.config.ts`: `/office/repairing/settings/pipelines/*` and `/office/settings/pipelines` both 307 to `/office/admin/pipelines`. Same for statuses and sub-statuses.

### API routes
- `/api/users[/[id]]` — user CRUD.
- `/api/roles[/[id]]` — role + permission grant matrix endpoints.
- `/api/permissions` — list of all defined permission IDs (read-only; source of truth is `prisma/seeds/bootstrap-seed.ts`).
- `/api/branches`, `/api/departments`, `/api/posts`, `/api/posts/[id]/holders`, `/api/posts/structure` — org structure.
- `/api/org-chart` — user reporting-line tree (consumed by org-chart page and social profile wall).
- `/api/settings/org-defaults` — GET (read singleton, auto-upserts row id=1) + PATCH (update). Permission: `settings:manage`.
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
- `OrgDefaults` — singleton (id=1) in `prisma/schema/org.prisma`. Fields: `defaultUnitId` (FK → `InvUnit`), `defaultGstRateId` (FK → `GstRate`), `defaultHsnCode`, `defaultTaxability`, `defaultSaleCreditPeriod` (days), `defaultPurchaseCreditPeriod` (days), `defaultCurrencySymbol`. Auto-upserted on first GET; bootstrap seed upserts the row with `defaultGstRateId` pointing to the 18% `GstRate` row. Acts as final fallback in the GST/HSN cascade (after product and all group ancestors return null).
- `Pipeline`, `TicketStatus`, `TicketSubStatus`, `SubStatusGroup`, `StatusTransition`, `SubStatusTransition` (in `prisma/schema/pipeline.prisma`).

## Key components / library

- `src/modules/admin/components/OrgDefaultsForm.tsx` — client form for org defaults (axios + sonner, no react-hook-form since single flat state). Loads `GstRate` options from `/api/inventory/gst-rates` and renders a Select (not a text input) for `defaultGstRateId`.
- **Org chart tab views** (`/office/admin/org-chart` — 6 tabs):
  - `OrgTree.tsx` — Tab 1 "People Chart": reporting-line tree powered by `/api/org-chart` (`OrgNode[]`).
  - `StructureTree.tsx` — Tab 2 "Structure Chart": 4-level CSS-connector hierarchy (Executive Council → Branch → Dept → Post) built from `OrgStructure`. Renders `PostCard`, `DeptGroup`, `BranchNode`, `OrgWideRow` with `VLine`/`HBar` primitives.
  - `OrgExplorer.tsx` — Tab 3 "Explorer (beta)": dashboard-style search + branch-filter chips + hover/pin detail panel.
  - `OrgHierarchy.tsx` — Tab 4 "Hierarchy (beta)": top-down tree rooted at Board; click-to-highlight lineage path; collapse/expand nodes; zoom controls.
  - `OrgLevels.tsx` — Tab 5 "Levels (beta)": classic level-based view — L1 Board (gold), L2 Branches (blue), L3 Departments (green), L4 Positions (purple); dark canvas with staggered `orgLevelFadeUp` animations.
  - `OrgRegions.tsx` — Tab 6 "Regions (beta)": HQ container (amber) + regional branch cards (emerald); `HQ_BRANCH_ID = "BR-HQ"` sentinel separates HQ from regional branches; posts auto-classified by title regex into Board / Chief Executive / C-Level / Central Departments sections.
- `src/shared/types/orgChart.ts` — shared types for all org-chart views:
  - `OrgNode` — reporting-line node (used by OrgTree / `/api/org-chart`).
  - `PostNode` — post + holders shape (used by StructureTree / Explorer / Hierarchy / Levels / Regions).
  - `DeptGroup { dept; posts }`, `BranchGroup { branch; deptGroups }`, `OrgStructure { orgWidePosts; branches }` — grouped structure shape returned by `/api/posts/structure` and consumed by Tabs 2-6.
- `src/shared/lib/schemas/orgDefaultsSchemas.ts` — `orgDefaultsUpdateSchema` (zod). Reusable for downstream wiring (product/voucher defaults).
- `src/shared/lib/auth/authGuard.ts` — `requireAuth`, `requirePermission`, `requireRole`, `hasPermission`.
- `src/shared/lib/auth/permissionScope.ts` — `hasPermissionWithScope` (handles `area:op:scope` lookup with widening).
- `src/shared/lib/auth/makePermissionLayout.tsx` — `makePermissionLayout(permission)` — used by every `office/admin/<page>/layout.tsx`.
- `src/shared/lib/auth/permissions.ts` — UI helpers.
- `prisma/seeds/bootstrap-seed.ts` — single source of truth for permission IDs + role grants. Reseed (`pnpm prisma db seed`) is required to add new permissions.

## Common workflows (wiring)

1. **Add a new permission ID** — edit `PERMISSIONS` array in `prisma/seeds/bootstrap-seed.ts` → run `pnpm prisma db seed` → user opens `/office/admin/role` and ticks the new row for relevant roles.
2. **Create / edit a pipeline** — `/office/admin/pipelines` → calls `/api/pipelines[/[id]]` → ButtonBar reflects new pipeline immediately for users with appropriate role grants.
3. **Assign role to user** — `/office/admin/users/[id]` → updates user's `role` field (R1 Admin / R2 Tech / R3 Front Desk / R4 Despatch).
4. **Org chart structure** — `/api/posts/structure` returns `OrgStructure` (not a flat list). It groups every `Post` as: `branchId == null` → `orgWidePosts`; otherwise bucketed into `branches[].deptGroups[]`. Tabs 2-6 all consume this single endpoint. The People Chart tab (Tab 1) uses the separate `/api/org-chart` endpoint which returns `OrgNode[]` (parent/child reporting-line tree).
5. **Branch/Department counts** — `/api/branches` and `/api/departments` compute user + dept counts from `Post` records first (using `Set`-based deduplication of `userId`/`departmentId` across all posts in that branch), then fall back to the legacy `_count` relations (`User.branches[]` / `User.departments[]`) if Posts return zero. This supports the mid-transition period where some users are connected only via Posts while older users may still use direct relations.

## Recent decisions / gotchas

- **2026-05-07 (Step 0)**: 4 demo users seeded with predictable passwords — see [permission_matrix memory](../../memory/permission_matrix.md) for the table.
- **2026-05-07 (Step 0)**: 10 new `accountancy:*` permission rows added. Admin (R1) gets them via `PERMISSIONS.map(p => p.id)`. Non-admin roles need explicit grant via the matrix.
- **2026-05-07 (Step 2)**: Pipelines / statuses / sub-statuses moved from Repair settings to Admin (`/office/admin/pipelines` etc.).
- **2026-05-19 (V1 complete)**: Settings module marked done in [completed-and-protected.md](../completed-and-protected.md). Treat permission matrix, user CRUD, org-shape masters, and pipeline/status machinery as preserve-first unless explicitly requested.
- **2026-05-19 — Org chart restructure**: `/api/posts/structure` was rewritten from a `parentPostId`-based flat tree to a `branch → dept` grouping (`OrgStructure`). `parentPostId` is still stored in the schema but is no longer the primary rendering axis. The flat tree was useless for demo data where all posts had `parentPostId = null`.
- **2026-05-19 — Posts page dept-filter bug fix**: departments are seeded with `branchId = null` (org-wide). The Posts page branch-section expansion filter was `d.branchId === branch.id`, which excluded all org-wide departments. Fixed to `d.branchId === branch.id || d.branchId === null` so any branch can display positions in org-wide departments.
- **2026-05-19 — Rich demo seed**: `prisma/seeds/dummy-org-rich.ts` (`pnpm seed:dummy-org-rich`) creates 36 users, 36 posts, 5 branches (HQ + 4 regional), 10 departments matching a realistic company org chart. `HQ_BRANCH_ID = "BR-HQ"` is the sentinel used by `OrgRegions` to separate HQ from regional branches.
- **Position-based model (mid-transition)**: The long-term plan replaces direct `User.role` / `User.branches[]` / `User.departments[]` with `Post` (position) appointments. Code currently runs in dual-mode — Posts are the source of truth for new data; legacy direct relations are kept as fallback. See the plan file at `~/.claude/plans/user-and-branch-implementation-deep-goose.md` for the full roadmap.
- **Future scope tier `post`** (between `own` and `department`) is planned but **not yet in code**. `permission-scope.ts` order is currently `own → department → branch → org`.

## Out of scope / deferred

- A "permissions UI" that adds new permission rows from the app — does not exist; reseed is required.
- A `permissions:edit` permission gate — no, since changes happen via seed file edits + reseed, not at runtime.

_Last updated: 2026-05-19 — Added 6-tab org chart architecture (OrgStructure type, StructureTree/Explorer/Hierarchy/Levels/Regions components), Posts-based branch/dept counts, rich demo seed, Posts page dept-filter fix, position-based model transition note._
