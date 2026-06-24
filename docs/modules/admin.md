# Admin

> Org-shape and RBAC: users, roles + permissions, branches, departments, positions, org-chart, POS counters. Configuration concerns (pipelines, statuses, org-defaults, year-ending, naming-convention, printer-settings) were carved out into the [Settings module](./settings.md) on 2026-05-20.

## URLs

### Layout / in-section nav
- `office/admin/layout.tsx` — SSR shell; passes session permissions to `AdminNav`.
- `office/admin/loading.tsx` — content-area skeleton; nav from the layout stays visible during navigation.
- `src/modules/admin/components/AdminNav.tsx` — client grouped tab bar (People → Org structure → Access → POS). Items and permissions come from `ADMIN_NAV` in `src/utils/constants.ts`; groups are ordered via slug lists inside `AdminNav`.

### UI pages (all inside `office/admin/` — real URL segments, no route groups)
- `/office/admin/users` — `office/admin/users/{layout,page}.tsx`
- `/office/admin/role` — Roles UI (the **Enterprise Permission Matrix** lives here)
- `/office/admin/branches`, `/office/admin/departments`, `/office/admin/positions`
- `/office/admin/org-chart` — visual hierarchy
- `/office/admin/counters` — POS counter management — create / rename / activate / delete, plus an editable **payment-accounts list** (each row = method dropdown + label + linked bank ledger + optional UPI/gateway **VPA** for the Share QR; add several, e.g. UPI 1 → HDFC and UPI 2 → SBI). See [pos.md](./pos.md).

> 2026-05-11: route groups `(admin)`, `(core)`, `(message)`, `(roadmap)`, `(social)` were promoted to real URL segments. Sub-paths now carry their module prefix (e.g. `/office/branches` → `/office/admin/branches`, `/office/users` → `/office/admin/users`, profile pages `/office/users/[id]` → `/office/social/users/[id]`).

> 2026-05-20: pipelines, statuses, workers, org-defaults, year-ending, naming-convention, printer-settings moved out to `/office/settings/*`. See [settings.md](./settings.md). Hard cut — no `/office/admin/<page>` → `/office/settings/<page>` redirects.

> 2026-05-20: org-chart `Post` model renamed to `Position` (and `UserPost` → `UserPosition`). UI moved from `/office/admin/posts` to `/office/admin/positions`; API moved from `/api/posts` to `/api/positions`. The deprecated `User.branches` / `User.departments` many-to-many relations were dropped at the same time — branches/departments a user belongs to are now derived purely from their Position assignments.

### API routes
- `/api/users[/[id]]` — user CRUD.
- `/api/roles[/[id]]` — role + permission grant matrix endpoints.
- `/api/permissions` — list of all defined permission IDs (read-only; source of truth is `prisma/seeds/bootstrap-seed.ts`).
- `/api/branches`, `/api/departments`, `/api/positions`, `/api/positions/[id]/holders`, `/api/positions/structure` — org structure.
  - `PATCH /api/branches/[id]` accepts optional `id` field to rename the branch — all FK references (`Department.branchId`, `Position.branchId`, inventory, POS, GL) cascade automatically (`ON UPDATE CASCADE`).
  - `DELETE /api/positions/[id]/holders/[userId]` — detaches a holder without deleting the position.
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
- `Branch`, `Department` (+ `isAllAccess`), `Position`, `UserPosition` (org-shape, in `prisma/schema/org.prisma`).
- `Role` (+ required `departmentId`), `Permission`, `RolePermission`, `DepartmentPermission` (department permission pool — the Role Matrix authoring lens), in `prisma/schema/rbac.prisma`.

> `OrgDefaults`, `Pipeline`, `TicketStatus`, `TicketSubStatus`, `SubStatusGroup`, `StatusTransition`, `SubStatusTransition` are documented in [settings.md](./settings.md).

## Key components / library

- `src/modules/admin/components/AdminNav.tsx` — in-section nav for all `/office/admin/*` pages (see Layout above). Mirrors the voucher-registers pattern (`VouchersRegistersNav`).
- `ADMIN_NAV` in `src/utils/constants.ts` — single source of truth for admin tab labels, icons, hrefs, and permission keys consumed by `AdminNav` and the office sidebar.

> The `OrgDefaultsForm` UI moved to the [Settings module](./settings.md) — see `src/modules/settings/components/OrgDefaultsForm.tsx`.

- **Org chart tab views** (`/office/admin/org-chart` — 5 tabs; People Chart and Levels tabs removed):
  - `StructureTree.tsx` — Tab "Structure": 4-level CSS-connector hierarchy (Executive Council → Branch → Dept → Position) built from `OrgStructure`. Renders `PositionCard`, `DeptGroup`, `BranchNode`, `OrgWideRow` with `VLine`/`HBar` primitives.
  - `OrgExplorer.tsx` — Tab "Explorer (beta)": dashboard-style search + branch-filter chips + hover/pin detail panel.
  - `OrgHierarchy.tsx` — Tab "Hierarchy (beta)": top-down tree rooted at Board; click-to-highlight lineage path; collapse/expand nodes; zoom controls.
  - `OrgRegions.tsx` — Tab "Regions (beta)": visual org builder. Three-tier layout: **Executive Council band** (sky, org-wide positions — above HQ) → **HQ container** (amber, BR-HQ-scoped positions) → **Regional branch cards** (emerald). `HQ_BRANCH_ID = "BR-HQ"` sentinel. Right-click any card for contextual actions (add child, appoint holder, transfer/promote holder, remove holder, delete). `canManage` prop (derived from `settings:manage`) gates all mutations. "Create HQ" dashed CTA when no BR-HQ exists.
  - `OrgCanvas.tsx` — Tab "Canvas (beta)": custom drag/pan/zoom canvas (no xyflow — incompatible with React 19). Absolute-positioned cards + SVG bezier connector lines. Pan via pointer drag on background, drag nodes via pointer capture, mouse-wheel zoom centered on cursor. View-only (create/edit stays on Regions tab).
- **Org chart dialogs** (`src/modules/admin/components/`):
  - `OrgRegionsCreateDialog.tsx` — single dialog switching between branch / department / position create forms. IDs are auto-generated client-side (`BR-{slug}`, `DEPT-{slug}`, `POS-{slug}`) with 409-retry (`-2`, `-3` …). `forceId` path used for "Create HQ" (sends exactly `BR-HQ`). Native `<datalist>` type-ahead from existing titles/names.
  - `OrgAppointDialog.tsx` — searchable user picker; POST `/api/positions/[id]/holders`. Existing holders shown dimmed.
  - `OrgTransferDialog.tsx` — searchable position picker for moving a holder. Atomic: DELETE source → POST target; rolls back to source if POST fails.
- **Org chart classification** (`src/modules/admin/lib/orgChartClassification.ts`): `ORG_CLASSIFICATION_RULES` array drives which section a position title lands in (Board of Directors / Chief Executive / C-Level / Org-Wide). Edit this file to add new keywords — no component code change needed. `classifyPosition(title): OrgSection` is the exported classifier; `SECTION_LABELS` maps section keys to display strings.
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

- **2026-06-24 — Department-wise roles + permission pools.** The Role Matrix (`/office/admin/role`) is now scoped by department. Every `Role` has a required home department (`Role.departmentId`); a new `DepartmentPermission` join holds each department's curated **pool**, edited on `/office/admin/departments` ("Permissions" button → `PUT /api/departments/[id]/permissions`). The role editor filters its matrix + chips to the role's pool; an all-access department (`Department.isAllAccess`, seeded `DEP-ADMIN`) shows the full list. **Positions no longer pick a department independently** — `/office/admin/positions` derives it from the chosen role template (read-only; a role-less seat may still pick one), and the positions API stamps `role.department` on save. Pool removal cascades to roles in the department (API returns the count). Authoring concern only — `authorizeStaff.ts` resolution is unchanged. See [permissions.md](./permissions.md) "Department-wise roles & permission pools".
- **2026-05-07 (Step 0)**: 4 demo users seeded with predictable passwords — see the demo-logins table in [seeds.md](../seeds.md) and the role catalogue in [permissions.md](./permissions.md).
- **2026-05-07 (Step 0)**: 10 new `accountancy:*` permission rows added. Admin (R1) gets them via `PERMISSIONS.map(p => p.id)`. Non-admin roles need explicit grant via the matrix.
- **2026-05-07 (Step 2)**: Pipelines / statuses / workers moved from Repair settings to Admin (`/office/admin/pipelines` etc.).
- **2026-05-19 (V1 complete)**: Admin module marked done in [completed-and-protected.md](../completed-and-protected.md). Treat permission matrix, user CRUD, org-shape masters as preserve-first unless explicitly requested. Pipeline/status machinery is in [settings.md](./settings.md).
- **2026-05-20 (V1.5 complete)**: `office/admin/layout.tsx` + `AdminNav` + `admin/loading.tsx`. Grouped in-section tabs replace hopping via sidebar only; `admin:bypass` or per-item permission gates visibility. Marked preserve-first in [completed-and-protected.md](../completed-and-protected.md).
- **2026-05-20 — Settings extracted.** Pipelines, statuses, workers, org-defaults, year-ending, naming-convention, printer-settings moved out to `/office/settings/*`; `OrgDefaultsForm` moved to `src/modules/settings/components/`. See [settings.md](./settings.md). Admin keeps users, roles, branches, departments, positions, org-chart, counters.
- **2026-05-20 — Position rename + M2M drop.** `Post` → `Position`, `UserPost` → `UserPosition` (table rename via `prisma db push`, prior data dropped). Deprecated `User.branches` / `User.departments` many-to-many relations removed; admin no longer assigns branches/departments directly on a user — those access lists are derived from the user's Position assignments. Delete guards on `/api/branches/[id]`, `/api/departments/[id]`, and `/api/positions/[id]` were rewritten to count Position-derived relations (previously counted the empty M2M and silently orphaned children).
- **2026-05-19 — Org chart restructure**: `/api/positions/structure` was rewritten from a `parentPositionId`-based flat tree to a `branch → dept` grouping (`OrgStructure`). `parentPositionId` is still stored in the schema but is no longer the primary rendering axis.
- **2026-05-19 — Rich demo seed**: `prisma/seeds/dummy-org-rich.ts` (`pnpm seed:dummy-org-rich`) creates 36 users, 36 positions, 5 branches (HQ + 4 regional), 10 departments matching a realistic company org chart. `HQ_BRANCH_ID = "BR-HQ"` is the sentinel used by `OrgRegions` to separate HQ from regional branches.
- **2026-05-20 — Regions tab rebuilt as visual org builder**: People Chart and Levels tabs removed. Regions tab now has full create/appoint/transfer/remove via right-click context menus gated by `settings:manage`. Canvas (beta) tab added (custom canvas, no xyflow — xyflow v12 is incompatible with React 19: nodes stay `visibility:hidden`, edges never render). Executive Council (org-wide positions) now renders in its own band **above** HQ rather than inside it. Position-to-section classification extracted to `src/modules/admin/lib/orgChartClassification.ts` (editable config, no component changes needed to adjust keyword rules).
- **2026-05-20 — Branch ID editable in admin UI**: `/office/admin/branches` edit form now exposes the ID field. `PATCH /api/branches/[id]` accepts an `id` field; all FK constraints are `ON UPDATE CASCADE` so the rename propagates to every linked table automatically.
- **Future scope tier `position`** (between `own` and `department`) is planned but **not yet in code**. `permission-scope.ts` order is currently `own → department → branch → org`.

## Out of scope / deferred

- A "permissions UI" that adds new permission rows from the app — does not exist; reseed is required.
- A `permissions:edit` permission gate — no, since changes happen via seed file edits + reseed, not at runtime.

_Last updated: 2026-05-24 — `/office/admin/counters` mapping rows gained an optional **custom label input** alongside each account picker (e.g. rename "UPI" → "PhonePe UPI" per counter). Empty label uses the built-in name. Backed by 5 new sibling `*Label String?` columns on `PosCounter` (`upiLabel` / `cardLabel` / etc.). Surfaced in POS checkout (UPI fixed row + extras dropdown). Earlier today: edit form gained a "Payment options accepted at this counter" section: 5 mapping rows (UPI / Card / Wallet / Cheque / Bank Transfer) each backed by `GlAccountCombobox` (inline ledger create supported). Each mapping is a nullable `accountId` column on `PosCounter`; null = method hidden in POS checkout. `PATCH /api/pos/counters/[id]` accepts the 5 new fields and validates each id resolves to an ASSET ledger. See [pos.md](./pos.md) for the POS-side wiring. Earlier today: `/office/admin/branches` page got the structured-address / contact form refresh from the Organisation settings update (commit `b647e33`). `Branch` now carries structured address fields + `gstStateCode`; the branches page form is the canonical edit UI. No behaviour change to branch resolution / scoping. Previously (2026-05-22): `OrgRegionsCreateDialog` form-key derivation switched from `setState`-in-effect to `useMemo` (React 19 hygiene; no behaviour change). Previously (2026-05-20): V1.5 in-section nav (`layout.tsx`, `AdminNav`, `loading.tsx`); grouped tabs from `ADMIN_NAV`._
