# PROJECT BRAIN — ServiceMgmt

> Internal service management system for an electronics repair shop — tracking tickets, team handoffs, and customer communication across Front Desk, Technician, Despatch, and Admin roles.

**Stack:** Next.js 16.2.3 (App Router), React 19, PostgreSQL (Supabase), Prisma 7.7.0, NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Sonner (toasts), Axios, React Hook Form  
**Repo:** `D:\our-own-website\service-mgmt-experiment` (local, git branch: `dev`)  
**Started:** 2026-04-17  
**Last Updated:** 2026-04-19 18:00

---

## 🎯 Goal

Replace paper/spreadsheet job tracking at the repair shop with a real internal tool. Every ticket moves through a defined workflow (Received → Diagnosing → Repairing → … → Returned). Each role (Front Desk, Technician, Despatch, Admin) sees only their relevant work. Sub-statuses communicate team handoffs. Long-term: evolve into a full ERP/CRM platform for the office.

---

## 🏁 Milestones

| # | Milestone | Status | Completed |
|---|-----------|--------|-----------|
| 1 | Core ticket flow (create, view, status transitions) | ✅ Done | 2026-04-17 |
| 2 | Sub-status system + notifications | ✅ Done | 2026-04-18 |
| 3 | Role-based access + role dashboards | ✅ Done | 2026-04-18 |
| 4 | Multi-role + Permission Foundation (Phase 1) | ✅ Done | 2026-04-19 |
| 5 | Warranty System (Phase 2) | ✅ Done | 2026-04-19 |
| 6 | Task System (Phase 3) | ✅ Done | 2026-04-19 |
| 7 | Cross-User Delegation + UX polish (Phase 4) | ✅ Done | 2026-04-19 |
| 8 | ERP Module Foundation (Phase 5) | ⏳ Archived — implement later | — |
| 9 | Reporting & Analytics | ⏳ Not Started | — |

> **Current Milestone:** Day-to-day usability improvements + Bug fixes

---

## ✅ Completed Work

### 2026-04-19 — Phase 4 complete + UX sprint + Bug fixes
- **Fixed "Failed to update status" bug**: task creation in sub-status route now wrapped in try-catch per role (uses `findFirst` + `create` instead of brittle `createMany skipDuplicates`) — sub-status updates never blocked by task creation errors
- **Escalation improvements**: button now only visible when `fromTransitions` includes S4 (config-driven, not hardcoded); auto-creates Despatch (R4) task on fresh escalation; "Add External Ref # / RMA" inline edit action appears when ticket is already escalated
- **Sidebar collapsed Settings**: Statuses / Sub-Statuses / Roles grouped under a collapsible "Settings" chevron — saves vertical space; auto-opens when on a settings page; sidebar width reduced to `w-56`
- **Phase 4 — Task delegation**: `/api/tasks/[id]/pickup` (POST, requires `tasks:pickup`) sets `pickedUpById`; `/api/tasks/[id]/help` (POST) logs assistance without ownership transfer; `scope=own` in task list also shows picked-up tasks; `TaskList` shows "Picked up by [name]" banner + Pick Up / Help With buttons gated by `tasks:pickup` permission
- **Users — Permissions modal**: ShieldCheck button per user row; modal groups all permissions by module; role-granted shown as read-only "Role" badge; admin can grant/deny individual overrides ("+Grant" / "Deny" badge); saves via `PUT /api/users/[id]/permissions`
- Files: `src/app/api/tickets/[id]/sub-status/route.ts`, `src/app/api/tickets/[id]/route.ts`, `src/app/(protected)/tickets/[id]/page.tsx`, `src/components/Sidebar.tsx`, `src/app/api/tasks/[id]/pickup/route.ts`, `src/app/api/tasks/[id]/help/route.ts`, `src/app/api/tasks/route.ts`, `src/components/tasks/TaskList.tsx`, `src/app/(protected)/users/page.tsx`

### 2026-04-19 — Phase 3 — Task System
- `Task` and `TaskLog` models; `pickedUpById`/`pickedUpBy`/`pickedUpAt` fields on Task; back-relations on User, Ticket, Priority
- `/api/tasks` GET (scope=own/team/org, filter=open/done/today/overdue) + POST; `/api/tasks/[id]` GET/PATCH/DELETE
- `/tasks` page with scope tabs + filter chips; `TaskList` component (status cycle, expand, metadata); `CreateTaskModal` (assign to role or user, link ticket, due date)
- Sidebar: "Tasks" nav item (all roles)
- Auto-task creation in sub-status route when `notifyRoles` is set — best-effort, never blocks status update
- Dashboard task counts: Admin summary bar, Technician "open tasks" banner, FrontDesk and Despatch cards grid now 3 columns
- Files: `prisma/schema.prisma`, `src/app/api/tasks/`, `src/app/(protected)/tasks/page.tsx`, `src/components/tasks/`, `src/components/Sidebar.tsx`, `src/components/dashboard/*.tsx`, `src/app/(protected)/dashboard/page.tsx`

### 2026-04-19 — Phase 2 — Warranty System
- `warrantyScope` (string: any/warranty_only/non_warranty_only) on `TicketStatus` and `TicketSubStatus`; warranty fields on Ticket (`isWarranty`, `warrantyStatus`, `voidReason`, `warrantyRef`, `purchaseDate`); `WarrantyLog` audit table
- Bridge sub-statuses SS36 (Warranty Voided — Customer Approval Needed) and SS37 (Confirmed Under Warranty — Proceeding)
- `POST /api/tickets/[id]/warranty` — conversion endpoint (R1+R2); clears inapplicable sub-status; sets bridge sub-status; creates WarrantyLog; notifies R3
- `/api/sub-statuses/next` filters by `warrantyScope` via `isWarranty` query param
- `WarrantyBadge` component (amber/green/red); `WarrantyConvertModal` (direction toggle, void reason, notes)
- Ticket list: warranty filter chip + badge in status column; Ticket detail: warranty banner, "Manage Warranty" / "Mark as Warranty" action
- Settings: `warrantyScope` dropdown in both Statuses and Sub-Statuses settings

### 2026-04-19 — Phase 1 — Multi-Role + Permission Foundation
- `UserRole` join table (many-to-many), `Permission` model, `UserRolePermission`, `UserPermission` (per-user overrides)
- `managerId` self-relation on User for org hierarchy
- 13 permissions seeded; R1 gets all; R2/R3/R4 get role-appropriate subsets; system roles (R1–R4) flagged with `isSystem=true`
- JWT extended: `roles: string[]` + `permissions: string[]` alongside legacy `role`
- `requirePermission()` in `auth-guard.ts`; existing `requireRole()` untouched
- Settings → Roles page: create/delete/manage custom roles; per-role permission checkboxes; system roles locked from deletion
- `/api/roles/[id]/permissions` PUT; `/api/users/[id]/roles` GET+PUT; `/api/users/[id]/permissions` GET+PUT

### 2026-04-19 — Dashboard refactor into role components
- Extracted `AdminDashboard` and `TechnicianDashboard` into separate client components
- `fetchPipeline()` queries non-terminal statuses dynamically
- New `src/lib/time-ago.ts`

### 2026-04-18 — Role dashboards, sub-status system, auth, UX
- Front Desk call queue, Technician workbench, Despatch queue
- `allowedRoles`/`notifyRoles`/`actionLabel` on both `TicketStatus` and `TicketSubStatus`
- `triggerMap Json` per sub-status (replaces global `triggerStatusId`)
- `requireRole()` auth guards; server-side `userId` from `auth()` session
- `formatDate()` / `formatDateTime()` utility; `timeAgo()` utility
- Sub-status entry-point `NULLS NOT DISTINCT` fix

### 2026-04-17 — Core ticket flow
- 9 main statuses (S1–S9 + S10 Engineer Visited); full ticket CRUD; customer+device management; technician assignment; service centres; priorities; ticket logs; print receipt; escalation; notification bell

---

## 🔄 In Progress

- Nothing actively in progress

---

## 📋 Next Up (Prioritized)

1. **Quick UX wins** — U2 (duplicate Name column), U4 (mobile grid breakpoint), U11 (toast with status label), U16 (ticket list default sort by date desc)
2. **Escalation sub-status flow UX** — Make it clearer that after escalating to S4, Despatch should set SS19 (Engineer Visit Scheduled) or SS22 (Pending Despatch); consider an inline prompt in the ticket detail when status=S4 and sub-status is unset
3. **Reporting dashboard** — ticket counts by status over time, avg repair time, revenue, weekly charts (Recharts)
4. **Ticket list pagination** — server-side, with sort controls
5. **Customer portal** — read-only status page via shareable link

---

## 💡 Ideas & Notes

- 2026-04-19 **Phase 5 — ERP Module Foundation (archived)**: `AppSetting` model, static module registry `src/config/modules.ts`, module toggle settings page, module-driven sidebar. Implement when ready to add CRM / Inventory / HR / Finance modules.
- 2026-04-19 **Branch + Department structure**: `Branch` (physical site) + `Department` (functional group). Users and tickets get `branchId`. `data:all_branches` permission for managers.
- 2026-04-18 **SLA alerts**: Flag tickets in the same status for too long (e.g. "Diagnosing 5+ days")
- 2026-04-18 **Despatch courier integration**: Auto-generate tracking label from SS22 "Pending Despatch"

---

## ⚠️ Known Issues & Gotchas

- **Server restart required after `prisma generate`**: Turbopack caches Prisma client chunks. After any schema change → `prisma db push` → `prisma generate` → **restart dev server**. Otherwise old client is used and new model properties throw.
- **Next.js 16 breaking changes**: Middleware file is `src/proxy.ts` NOT `middleware.ts`.
- **Prisma adapter-pg**: Uses `@prisma/adapter-pg`. Datasource configured via `prisma.config.ts`.
- **NextAuth v5 beta**: Cast `session.user` to access `id`/`role`/`roles`/`permissions`. Never use `getToken()`.
- **Scalar list filtering**: `String[]` fields use `{ has: "R3" }` in Prisma (PostgreSQL only).
- **Sub-status `allowedRoles`**: R1 always bypasses — by design.
- **Opaque IDs**: Status IDs S1–S10, sub-statuses SS1–SS37, roles R1–R4, priorities P1–P4.
- **`@@unique` with nullable fields**: PostgreSQL treats NULL as distinct; `skipDuplicates` may not work reliably. Use `findFirst` + `create` pattern for workflow task deduplication.

---

## 🧠 Key Decisions Log

| Decision | Chosen | Alternatives Considered | Reason |
|----------|--------|------------------------|--------|
| Auth | NextAuth v5 JWT | Clerk, custom JWT | Free, open source, fits stack |
| Status IDs | Opaque strings (S1-S9) | Enums, UUIDs | Readable, stable |
| Sub-status trigger | `triggerMap Json` | Separate trigger table | Simpler; JSON stores per-parent target |
| Multi-role users | `UserRole` join table | Changing `User.role` to array | Additive; legacy `User.role` kept for compat |
| Warranty scope | Plain string on both Status and SubStatus | Enum / status-only | Zero migration impact; defaults to "any" |
| Warranty conversion | Dedicated `/warranty` endpoint + bridge SS | Sub-status transition | Conversion changes data model, not just workflow |
| Task deduplication | `findFirst` + `create` wrapped in try-catch | `createMany skipDuplicates` | More reliable with nullable unique constraint fields |
| Escalation visibility | `fromTransitions.some(t => t.to.id === "S4")` | Hardcoded status IDs | Config-driven; status graph controls when escalation is available |
| Settings nav | Collapsible sidebar section | Separate settings layout | Saves vertical space; groups related admin items |
| Phase 5 (ERP modules) | Archived for later | Immediate implementation | Core workflows must be stable first; modules add complexity without day-1 value |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── (protected)/
│   │   ├── dashboard/         # Role-specific dashboards (server component)
│   │   ├── tickets/           # Ticket list + detail pages
│   │   ├── tasks/             # Tasks page (My / Team / Org scopes)
│   │   ├── customers/         # Customer management
│   │   ├── service-centers/   # Service centre CRUD (Admin+Tech)
│   │   ├── users/             # User management + permissions modal (Admin)
│   │   └── settings/
│   │       ├── statuses/      # Main status settings
│   │       ├── sub-statuses/  # Sub-status settings + flow editor
│   │       └── roles/         # Role + permission management (Admin)
│   ├── api/
│   │   ├── tickets/[id]/      # GET, PUT, sub-status, warranty, reopen, notes
│   │   ├── tasks/             # GET, POST; [id] GET/PATCH/DELETE; pickup; help
│   │   ├── sub-statuses/      # CRUD + transitions + next (filtered by scope+warranty)
│   │   ├── ticket-statuses/   # Main status CRUD + transitions
│   │   ├── users/[id]/        # roles, permissions endpoints
│   │   ├── roles/[id]/        # permissions endpoint
│   │   └── ...                # customers, service-centers, notifications, priorities
│   └── login/
├── components/
│   ├── dashboard/             # AdminDashboard, TechnicianDashboard
│   ├── tasks/                 # TaskList, CreateTaskModal
│   ├── StatusUpdateCombined.tsx
│   ├── WarrantyBadge.tsx
│   ├── WarrantyConvertModal.tsx
│   ├── TicketEscalation.tsx
│   ├── NotificationBell.tsx
│   └── Sidebar.tsx            # Collapsible Settings section
├── lib/
│   ├── prisma.ts
│   ├── permissions.ts         # hasPermission(), isAdmin(), requirePermission()
│   ├── auth-guard.ts          # requireRole(), requirePermission()
│   ├── format-date.ts
│   └── time-ago.ts
├── auth.ts                    # NextAuth config
├── auth.d.ts                  # Session type augmentation (id, role, roles, permissions)
└── proxy.ts                   # Auth middleware
prisma/
├── schema.prisma              # Full schema (Task, TaskLog, WarrantyLog, UserRole, Permission…)
├── prisma.config.ts
└── seed.ts + seed-phase1.ts + seed-phase2.ts
```

---

## 🔗 External Resources

- **Supabase project**: PostgreSQL database (aws-1-ap-south-1.pooler.supabase.com)
- **Next.js 16 docs**: `node_modules/next/dist/docs/`
- **NextAuth v5 docs**: https://authjs.dev/
- **Prisma docs**: https://www.prisma.io/docs/
