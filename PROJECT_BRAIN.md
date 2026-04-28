# PROJECT BRAIN — ServiceMgmt

> Internal service management system for an electronics repair shop — tracking tickets, team handoffs, and customer communication across Front Desk, Technician, Despatch, and Admin roles.

**Stack:** Next.js 16.2.3 (App Router), React 19, PostgreSQL (Supabase), Prisma 7.7.0, NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Sonner (toasts), Axios, React Hook Form, Zod  
**Repo:** `D:\our-own-website\service-mgmt-experiment` (local, git branch: `UI-Update`)  
**Started:** 2026-04-17  
**Last Updated:** 2026-04-29 00:00

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
| 6 | Task System (Phase 3) | ✅ Done then Removed | 2026-04-19 → removed 2026-04-21 |
| 7 | Cross-User Delegation + UX polish (Phase 4) | ✅ Done | 2026-04-19 |
| 8 | ERP Module Foundation (Phase 5) | ⏳ Archived — implement later | — |
| 9 | Assignment & Ownership System | ✅ Done | 2026-04-21 |
| 10 | Permission-based auth + API hardening | ✅ Done | 2026-04-23 |
| 11 | Pipeline System + CRM Foundation | ✅ Done | 2026-04-24 |
| 12 | Reporting & Analytics | ⏳ Not Started | — |

> **Current Milestone:** Milestone #12 — Reporting & Analytics (nothing in progress yet; codebase is clean)

---

## ✅ Completed Work

### 2026-04-28 — Message creation optimisation + Sentry setup
- **Messaging**: Replaced `createRoomMessage` helper with direct `prisma.chatMessage.create`; concurrent `updatedAt` write to `ChatRoom` in same operation for consistency; removed redundant `ensureCoreRooms` call on `getAccessibleRoom`
- **Sentry**: `@sentry/nextjs` version pinned to `10`; `next.config.ts` updated with org/project details, Vercel Cron Monitor auto-instrumentation, improved source-map handling; `sentry.server.config.ts` + `sentry.edge.config.ts` created; `.env.sentry-build-plugin` added to `.gitignore`
- Files: `src/app/api/inbox/rooms/[id]/messages/route.ts`, `src/lib/prisma.ts`, `src/modules/message/lib/inbox.ts`, `next.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

### 2026-04-27 — Domain module restructure + route groups
- **`src/modules/`** introduced: `core`, `customer`, `message`, `repairing`, `tally`, `shared` — domain-specific components and lib files moved into respective modules
- **Route groups** added inside `(protected)/`: `(admin)`, `(core)`, `(customer)`, `(message)`, `(repairing)`, `(tally)` — pages reorganised but URLs unchanged
- `assignments/` moved from `(repairing)` → `(core)` (cross-module work queue, not repairing-specific)
- **Constants centralised** into `src/utils/constants.ts`: `COLOR_OPTIONS`, `fmt()`, `INVOICE_STATUS_COLORS`, `JOURNAL_STATUS_COLORS`, `GL_TYPE_COLORS`, `GL_TYPE_ORDER`, `GlAccountType`, `WARRANTY_SCOPE_OPTIONS` — all local duplicates removed
- **Role labels**: Removed hardcoded `ROLE_LABELS`; new `GET /api/roles/labels` endpoint; `StatusUpdateCombined` + `SubStatusUpdate` fetch labels dynamically via `roleLabelMap`
- Files: `src/modules/*/`, `src/app/(protected)/(*/`, `src/utils/constants.ts`, `src/app/api/roles/labels/route.ts`

### 2026-04-27 — Neo Brutalism UI theme
- All `rounded-*` classes removed from every UI element (flat, sharp corners throughout)
- Raw colour values (`bg-white`, `bg-gray-*`, `text-gray-*`) replaced with Tailwind theme vars (`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`)
- All containers and inputs use `border-2 border-border`
- Raw modals converted to shadcn `Dialog` on accounts + finance detail pages
- shadcn primitives (`dialog`, `select`, `tabs`, `textarea`, `dropdown-menu`) patched to remove border-radius
- Tickets list + detail pages fully rewritten for the new theme
- Files: virtually all page and component files, `src/components/ui/*`

### 2026-04-27 — Supabase Realtime + Slack layout + build fix
- **Supabase Realtime**: `@supabase/supabase-js` installed via pnpm; `src/lib/supabase-client.ts` singleton; `InboxModule` subscribes to `ChatMessage INSERT` per active room — messages appear instantly across all users with no polling
- **Optimistic send**: message appears immediately with "sending…" label; Realtime replaces it with the confirmed DB record on success, rolls back on failure
- **Slack-style layout**: full-width messages, avatar + bold name + timestamp per group, consecutive messages from same sender grouped, own messages have `bg-primary/5` row tint
- **Notifications**: Web Notifications API (browser permission requested on mount) + Web Audio API "ding" sound for incoming messages from other users
- **Avatar colour fix**: own avatar = `bg-primary/20 text-primary`; others = `bg-muted text-foreground` — no more red circles for other users
- **Timestamp fix**: Supabase Realtime omits UTC 'Z' suffix — normalised before `new Date()` parse
- **Personal Inbox removed**: `PERSONAL_INBOX` rooms no longer created; filtered from all queries
- **Build fix**: `QuickTicketButton.tsx` line 669 — `technician.id` wrapped in `String()` for `SelectItem.value`
- Files: `src/components/InboxModule.tsx`, `src/lib/supabase-client.ts`, `src/lib/inbox.ts`, `src/app/(protected)/inbox/page.tsx`, `src/components/QuickTicketButton.tsx`, `.env`

### 2026-04-26 — Inbox UI overhaul + expandable sidebar nav
- **InboxModule rewrite**: rooms now grouped by type (System / Personal / Groups / Others) with collapsible sections; proper chat bubble layout (own messages right, others left, system centered); auto-scroll to bottom; Enter to send / Shift+Enter for newline; relative timestamps ("2m ago")
- **Sidebar Inbox section**: Inbox moved from flat WORKSPACE_NAV link to an expandable accordion — shows System / Personal / Groups sub-sections each with live unread counts fetched from `/api/inbox/rooms`; total unread badge on the Inbox header
- **Inbox page**: now passes `currentUserId` (from session) to InboxModule so own messages are aligned right; wrapped in Suspense for `useSearchParams` compatibility
- Files: `src/components/InboxModule.tsx`, `src/components/Sidebar.tsx`, `src/utils/constants.ts`, `src/app/(protected)/inbox/page.tsx`

### 2026-04-24 — Customer + Company model split (Milestone 11 finale)
- **Separated Account → Customer + Company**: `Customer` model (individuals) + `Company` model (businesses) + `CustomerCompany` join table for many-to-many links; `Account` model retained as legacy bridge
- **New pages**: `/customers/[id]` full detail + `/companies` list + `/companies/[id]` detail
- **New API routes**: `GET/PATCH/DELETE /api/customers/[id]`, `GET/POST /api/companies`, `GET/PATCH/DELETE /api/companies/[id]`, `POST /api/companies/[id]/links`
- **New components**: `CompanyLinkPanel.tsx`, `CustomerLinkPanel.tsx` — manage many-to-many links inline
- **QuickTicketButton** refactored to support `initialPipelineId` and pipeline-aware creation flow
- Files: `prisma/schema.prisma`, `src/app/(protected)/customers/`, `src/app/(protected)/companies/`, `src/app/api/customers/`, `src/app/api/companies/`, `src/components/companies/`, `src/components/customers/`

### 2026-04-24 — Account model + PipelineTransferModal
- Introduced `Account` model (type: individual/company, address, taxId) as step toward CRM; `AccountForm.tsx` reusable form
- `POST /api/tickets/[id]/transfer` — moves a ticket between pipelines; `PipelineTransferModal.tsx` UI
- `seed-business-pipelines.ts` — seeds Repair + Sales pipelines
- `/api/accounts` + `/api/accounts/[id]` + `/api/accounts/[id]/relationships` endpoints

### 2026-04-24 — Navigation overhaul: /assignments as default
- Default post-login redirect: `/assignments` (was `/dashboard`)
- Dashboard now accepts pipeline context; tickets page filtered by pipeline
- `proxy.ts` updated with new redirect target
- Files: `src/app/(protected)/dashboard/page.tsx`, `src/app/(protected)/tickets/page.tsx`, `src/proxy.ts`, `src/components/Sidebar.tsx`

### 2026-04-24 — UniversalCreateMenu + layout
- `UniversalCreateMenu.tsx` — floating "+" menu in `ProtectedLayout` for quick access to create actions
- Sidebar dynamically fetches and displays active pipelines (server-side); pipeline switching navigation
- Files: `src/components/UniversalCreateMenu.tsx`, `src/app/(protected)/layout.tsx`, `src/components/Sidebar.tsx`

### 2026-04-24 — Pipeline System (Milestone 11 core)
- `Pipeline` model: `id`, `name`, `label`, `description`, `color`, `isDefault`, `isActive`, `order`
- `TicketStatus`, `TicketSubStatus`, `Ticket` all have `pipelineId` — statuses/sub-statuses can be scoped to a pipeline
- `isEntryPoint Boolean @default(false)` added to `TicketStatus`
- `isEntryPoint` checkbox added to sub-status form in settings UI
- New settings page `/settings/pipelines` (full CRUD)
- `seed-pipelines.ts`
- Files: `prisma/schema.prisma`, `src/app/(protected)/settings/pipelines/page.tsx`, `src/app/(protected)/settings/statuses/page.tsx`, `src/app/(protected)/settings/sub-statuses/page.tsx`

### 2026-04-23 — Auth type cleanup + role selection fixes
- `auth.d.ts` import changed to type-only; role selection logic in `RolesSettingsPage` and `UserForm` refactored
- `UserForm` enforces at least one role selected; uses role IDs from DB properly
- Files: `src/auth.d.ts`, `src/components/UserForm.tsx`, `src/app/(protected)/settings/roles/page.tsx`

### 2026-04-23 — Zod validation across all API endpoints (Milestone 10)
- Zod schemas added to: roles, sub-statuses, ticket-statuses, users, tasks (assign, notes, participants, sub-status, warranty, permissions)
- All endpoints return structured validation error messages on bad input
- Files: `src/app/api/roles/`, `src/app/api/sub-statuses/`, `src/app/api/ticket-statuses/`, `src/app/api/tickets/[id]/`, `src/app/api/users/`

### 2026-04-21 — Permission-based auth system (Milestone 10)
- All `requireRole("R1")` calls replaced with `requirePermission(...)` — permission-driven, not role-driven
- Layout guards check specific permissions; sidebar navigation uses permissions; dashboard routing uses permissions
- User creation assigns default role from DB (not hardcoded "R2")
- `ProtectedLayout` passes structured `{ id, roles, permissions }` user object downstream
- Warranty notifications updated to include all front-desk users regardless of role assignment method
- Files: `src/app/(protected)/layout.tsx`, `src/components/Sidebar.tsx`, `src/app/(protected)/assignments/page.tsx`, `src/app/(protected)/dashboard/page.tsx`, multiple API routes

### 2026-04-21 — Tasks feature removed
- Entire Tasks system deleted (was Milestone 6): `src/app/(protected)/tasks/`, `src/app/api/tasks/`, `src/components/tasks/`
- Dashboard simplified (no task counts)
- Sidebar "Tasks" nav item removed
- Decision: tasks were personal notepad; Assignment system + TicketParticipant handles workflow handoffs

### 2026-04-21 — Milestone 9 — Assignment & Ownership System
- `primaryOwnerId` on Ticket (renamed from `technicianId`); `TicketParticipant` model with `addedBySubStatusId` + `removedAt` (soft-delete)
- `POST /api/tickets/[id]/assign` — claim / pass / reject; optimistic lock on claim (Prisma `update where { primaryOwnerId: null }`)
- `GET/POST /api/tickets/[id]/participants` — list active secondaries; add secondary
- `DELETE /api/tickets/[id]/participants/[userId]` — soft-delete (self-removal bypasses permission check)
- Sub-status route updated: handoff logic (auto-assign if 1 candidate, returns `requiresAssignment` if multiple); auto-revert soft-deletes participants added by outgoing sub-status; all auto-task creation removed; `$transaction` wrapping; notifyRoles fixed to use `userRoles` relation
- `TicketOwnershipPanel.tsx` — primary owner + inline reassign + secondaries list + "Add Secondary"
- `HandoffPickerModal.tsx` — radio list of candidates on `requiresAssignment: true` response
- `PassRejectModal.tsx` — pass shows user picker; reject with confirmation
- `TicketCard.tsx` — conditional Claim / Pass / Reject buttons; `router.refresh()` after action
- Assignments page scopes: me = primary OR active secondary; team = direct reports via `managerId`; org = admin only
- Files: `prisma/schema.prisma`, `src/app/api/tickets/[id]/assign/`, `src/app/api/tickets/[id]/participants/`, `src/components/TicketOwnershipPanel.tsx`, `src/components/assignments/`, `src/app/(protected)/assignments/page.tsx`

### 2026-04-19 — Phase 4 complete + UX sprint + Bug fixes
- Fixed "Failed to update status" bug; escalation improvements (config-driven visibility, auto-creates Despatch task on fresh escalation, inline "Add External Ref # / RMA")
- Sidebar collapsible Settings section; sidebar width reduced to `w-56`
- Phase 4 task delegation: pickup/help endpoints; `TaskList` with picked-up banner
- Users permissions modal: ShieldCheck button per row; role-granted read-only badges; admin grant/deny overrides

### 2026-04-19 — Phases 1–3 (Multi-role, Warranty, Task System)
- See original entries above (Phase 1: UserRole/Permission models; Phase 2: Warranty system; Phase 3: Task system — later removed)

### 2026-04-18 — Role dashboards, sub-status system, auth, UX
- Front Desk / Technician / Despatch dashboards; `allowedRoles`/`notifyRoles`/`actionLabel` on statuses and sub-statuses; `triggerMap Json`; `requireRole()` guards

### 2026-04-17 — Core ticket flow
- 9 main statuses; full ticket CRUD; customer+device management; technician assignment; service centres; priorities; ticket logs; print receipt; escalation; notification bell

---

## 🔄 In Progress

- [ ] **UI-Update branch** — `src/modules/shared/components/Sidebar.tsx`: added `w-full` to sidebar link items (uncommitted). Staging for merge.

---

## 📋 Next Up (Prioritized)

### Milestone 12 — Reporting & Analytics
1. **Reporting dashboard** — Recharts; key metrics: tickets by status/pipeline, avg resolution time, technician workload
2. **Ticket list pagination** — cursor-based or offset; current list loads all records

### Quick UX wins (after reporting)
3. **U2 — duplicate Name column** in ticket list
4. **U4 — mobile grid** layout fixes
5. **U11 — toast label** improvements
6. **U16 — default date sort** on ticket list (newest first)

### Longer term
7. **Customer portal** — read-only view for customers to track their repair
8. **SLA alerts** — flag tickets in same status too long (e.g. "Diagnosing 5+ days")
9. **Branch + Department structure** — `Branch` (physical site) + `Department` (functional group); users + tickets get `branchId`
10. **ERP Module Foundation** — `AppSetting` model, static module registry, module toggle settings page (archived Phase 5)

---

## 💡 Ideas & Notes

- 2026-04-24 **Pipeline-specific dashboards**: Each pipeline (Repair, Sales) could have its own dashboard view with tailored KPIs rather than a single shared dashboard
- 2026-04-24 **Company portal**: B2B version of customer portal — companies see all devices/tickets linked to them
- 2026-04-19 **Despatch courier integration**: Auto-generate tracking label from SS22 "Pending Despatch"
- 2026-04-18 **SLA alerts**: Flag tickets in the same status for too long (e.g. "Diagnosing 5+ days")
- 2026-04-19 **Phase 5 — ERP Module Foundation (archived)**: `AppSetting` model, static module registry `src/config/modules.ts`, module toggle settings page, module-driven sidebar. Implement when ready to add CRM / Inventory / HR / Finance modules.
- 2026-04-19 **Branch + Department structure**: `Branch` (physical site) + `Department` (functional group). Users and tickets get `branchId`. `data:all_branches` permission for managers.

---

## ⚠️ Known Issues & Gotchas

- **Server restart required after `prisma generate`**: Turbopack caches Prisma client chunks. After any schema change → `prisma db push` → `prisma generate` → **restart dev server**.
- **Next.js 16 breaking changes**: Middleware file is `src/proxy.ts` NOT `middleware.ts`.
- **Prisma adapter-pg**: Uses `@prisma/adapter-pg`. Datasource configured via `prisma.config.ts`.
- **NextAuth v5 beta**: Cast `session.user` to access `id`/`role`/`roles`/`permissions`. Never use `getToken()`.
- **Scalar list filtering**: `String[]` fields use `{ has: "R3" }` in Prisma (PostgreSQL only).
- **Sub-status `allowedRoles`**: R1 always bypasses — by design.
- **Opaque IDs**: Status IDs S1–S10, sub-statuses SS1–SS37, roles R1–R4, priorities P1–P4, pipelines P-REPAIR/P-SALES.
- **`@@unique` with nullable fields**: PostgreSQL treats NULL as distinct; `skipDuplicates` may not work reliably. Use `findFirst` + `create` pattern.
- **Account model**: Still present in schema alongside `Customer` and `Company` — acts as a legacy bridge. The `Customer` and `Company` models are the source of truth going forward. `Account` may be cleaned up later.
- **Tasks feature removed**: `Task`/`TaskLog` models are still in `schema.prisma` (not dropped from DB) but all application code has been deleted. Safe to drop the tables when convenient.
- **Sentry example files**: `src/app/api/sentry-example-api/route.ts` and `src/app/sentry-example-page/page.tsx` were added by Sentry setup — remove before production deploy if not needed.
- **Module migration incomplete**: Some components may still live in `src/components/` rather than their domain module. Gradual migration is fine; no functional impact.

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
| Phase 5 (ERP modules) | Archived for later | Immediate implementation | Core workflows must be stable first |
| Ticket ownership | `primaryOwnerId` + `TicketParticipant` table | Single field / array field | Primary = accountable; secondaries = named helpers at stages; history preserved |
| Sub-status handoff | `handoffRole` on sub-status; auto-assign if 1, picker if multiple | Always manual / always auto | Removes friction for small teams; scales to larger ones |
| Handoff revert | `autoRevertOnClear` flag + `addedBySubStatusId` | Manual removal only | Sub-status-added participants auto-deleted when sub-status changes |
| Assignment page scopes | me = primary OR secondary; team = direct reports via `managerId`; org = admin only | Role-based notifyRoles filter | Ownership-based is accurate |
| Secondary sub-status rights | Secondaries CAN update sub-status | Primary-only updates | Secondaries are actively working the ticket; blocking creates friction |
| Tasks feature | Removed entirely | Keep as personal notepad | Assignment + TicketParticipant handles all workflow handoffs; tasks added unused complexity |
| Permission-based guards | `requirePermission(...)` everywhere | `requireRole("R1")` | Role-agnostic; admins can grant any permission to any role |
| API validation | Zod schemas on all write endpoints | Manual checks / no validation | Consistent error messages; type-safe parsed input |
| Pipeline system | `Pipeline` model scoping statuses/sub-statuses/tickets | Single flat workflow | Repair shop may have Repair + Sales + B2B pipelines with different workflows |
| Customer/Company split | Separate `Customer` + `Company` + `CustomerCompany` join | Single `Account` with type flag | Cleaner relations; companies have their own full pages + many-to-many with customers |
| Default post-login redirect | `/assignments` | `/dashboard` | Assignments page is the primary work surface for all roles |
| Concurrent claim | `update where { primaryOwnerId: null }` optimistic lock | Application-level check | Database atomicity; throws RecordNotFound on race condition |
| Codebase structure | `src/modules/<domain>/` + Next.js route groups | Flat `src/components/` + `src/app/(protected)/` | Codebase grew large enough to need domain boundaries; route groups keep URLs unchanged |
| UI theme | Neo Brutalism (sharp corners, `border-2`, theme vars only) | Default shadcn rounded style | Design decision for shop context; enforced by removing all `rounded-*` classes |
| Role labels | Dynamic fetch from `/api/roles/labels` | Hardcoded `ROLE_LABELS` constant | Roles are DB-driven; hardcoding would break when roles are renamed in settings |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── (protected)/
│   │   ├── layout.tsx               # ProtectedLayout with UniversalCreateMenu
│   │   ├── (core)/
│   │   │   ├── assignments/         # Primary work surface; me/team/org scopes
│   │   │   └── accounts/            # Legacy account pages (bridge)
│   │   ├── (repairing)/
│   │   │   ├── dashboard/           # Role-specific dashboards (pipeline context)
│   │   │   ├── tickets/             # Ticket list (pipeline-filtered) + detail
│   │   │   ├── service-centers/     # Service centre CRUD
│   │   │   └── settings/            # pipelines, statuses, sub-statuses, roles
│   │   ├── (customer)/
│   │   │   ├── customers/           # Individual customer list + detail
│   │   │   └── companies/           # Company list + detail
│   │   ├── (message)/
│   │   │   └── inbox/               # Real-time inbox (Supabase Realtime)
│   │   ├── (tally)/
│   │   │   └── finance/             # Chart of accounts, journal entries, invoices, reports
│   │   └── (admin)/
│   │       └── users/               # User management + permissions modal
│   ├── api/
│   │   ├── tickets/[id]/            # GET, PUT, sub-status, warranty, reopen, notes, assign, participants, transfer
│   │   ├── sub-statuses/            # CRUD + transitions + next (pipeline/warranty filtered)
│   │   ├── ticket-statuses/         # Main status CRUD + transitions
│   │   ├── pipelines/               # Pipeline CRUD
│   │   ├── customers/[id]/          # Customer CRUD
│   │   ├── companies/[id]/          # Company CRUD + links
│   │   ├── accounts/[id]/           # Legacy account endpoints + relationships
│   │   ├── inbox/rooms/             # Room listing + messages (Supabase-backed)
│   │   ├── users/[id]/              # roles, permissions endpoints
│   │   └── roles/[id]/              # permissions + labels endpoints
│   └── login/
├── modules/                         # Domain modules (introduced 2026-04-27)
│   ├── core/                        # Shared business logic
│   ├── customer/                    # Customer + Company components/lib
│   ├── message/                     # Inbox components + lib/inbox.ts
│   ├── repairing/                   # Ticket, assignment, dashboard components
│   ├── tally/                       # Finance/accounting components
│   └── shared/                      # Cross-module shared utilities
├── components/                      # App-level shared components
│   ├── UniversalCreateMenu.tsx      # Floating "+" create menu in layout
│   ├── QuickTicketButton.tsx        # Pipeline-aware quick ticket creation
│   ├── Sidebar.tsx                  # Collapsible Settings; dynamic pipeline nav
│   ├── InboxModule.tsx              # Slack-style real-time chat UI
│   └── ui/                          # shadcn primitives (Neo Brutalism patched)
├── lib/
│   ├── prisma.ts
│   ├── permissions.ts
│   ├── auth-guard.ts                # requirePermission() (replaces requireRole)
│   ├── supabase-client.ts           # Supabase singleton for Realtime
│   └── format-date.ts / time-ago.ts
├── utils/
│   └── constants.ts                 # Centralised: COLOR_OPTIONS, WARRANTY_SCOPE_OPTIONS, GL types, fmt()
├── auth.ts / auth.d.ts
└── proxy.ts                         # Auth middleware; redirects to /assignments
prisma/
├── schema.prisma                    # Pipeline, Customer, Company, CustomerCompany, Account, TicketParticipant…
├── prisma.config.ts
├── seed*.ts                         # seed, seed-phase1/2, seed-assignments, seed-pipelines, seed-business-pipelines
└── migrate-accounts.ts
```

---

## 🔗 External Resources

- **Supabase project**: PostgreSQL database (aws-1-ap-south-1.pooler.supabase.com)
- **Next.js 16 docs**: `node_modules/next/dist/docs/`
- **NextAuth v5 docs**: https://authjs.dev/
- **Prisma docs**: https://www.prisma.io/docs/
