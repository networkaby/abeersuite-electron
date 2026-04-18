# PROJECT BRAIN — ServiceMgmt

> Internal service management system for an electronics repair shop — tracking tickets, team handoffs, and customer communication across Front Desk, Technician, Despatch, and Admin roles.

**Stack:** Next.js 16.2.3 (App Router), React 19, PostgreSQL (Supabase), Prisma 7.7.0, NextAuth v5 beta (JWT), Tailwind v4, shadcn/ui, Sonner (toasts), Axios, React Hook Form  
**Repo:** `D:\our-own-website\service-mgmt-experiment` (local, git branch: `dev`)  
**Started:** 2026-04-17  
**Last Updated:** 2026-04-18 21:30

---

## 🎯 Goal

Replace paper/spreadsheet job tracking at the repair shop with a real internal tool. Every ticket moves through a defined workflow (Received → Diagnosing → Repairing → … → Returned). Each role (Front Desk, Technician, Despatch, Admin) sees only their relevant work. Sub-statuses communicate team handoffs (e.g. technician sets "Waiting: Customer Info" → front desk sees it as a call task on their dashboard). No external customer-facing portal yet — internal team only.

---

## 🏁 Milestones

| # | Milestone | Status | Completed |
|---|-----------|--------|-----------|
| 1 | Core ticket flow (create, view, status transitions) | ✅ Done | 2026-04-17 |
| 2 | Sub-status system + notifications | ✅ Done | 2026-04-18 |
| 3 | Role-based access + role dashboards | ✅ Done | 2026-04-18 |
| 4 | Reporting & analytics | ⏳ Not Started | — |
| 5 | Customer communication templates (SMS/email) | ⏳ Not Started | — |
| 6 | Invoice / receipt generation improvements | ⏳ Not Started | — |

> **Current Milestone:** Milestone #4 — Reporting & Analytics

---

## ✅ Completed Work

### 2026-04-18 — Role-based dashboard (action queues)
- Front Desk sees a **Call Queue**: tickets where `ticketSubStatus.notifyRoles` includes `R3` — shows customer name, phone, and plain-English action ("Call customer — quote ready for approval")
- Technician sees My Workbench: assigned tickets + "Waiting: Front Desk / Despatch" indicators
- Despatch sees Despatch Queue: tickets with `notifyRoles` includes `R4`
- Admin sees global stats + recent activity
- Fixed `open` count to use `ticketStatus.isTerminal: false` (was hardcoded `["S1","S2","S3"]`)
- Files: `src/app/(protected)/dashboard/page.tsx`

### 2026-04-18 — Settings page statuses fetched dynamically
- Sub-status form modal now fetches main statuses from `/api/ticket-statuses` instead of hardcoded array
- `StatusUpdateCombined` also fetches statuses for trigger label display
- Files: `src/app/(protected)/settings/sub-statuses/page.tsx`, `src/components/StatusUpdateCombined.tsx`

### 2026-04-18 — Auth bug fix (changedBy from client unreliable)
- `PUT /api/tickets/[id]` and `PATCH /api/tickets/[id]/sub-status` now derive `userId` from server-side `auth()` session instead of trusting `changedBy` from request body
- `Number(undefined)` = NaN was failing Prisma integer constraint
- Files: `src/app/api/tickets/[id]/route.ts`, `src/app/api/tickets/[id]/sub-status/route.ts`

### 2026-04-18 — Role-based access control
- Middleware (`src/proxy.ts`) handles unauthenticated → `/login` redirect
- Server layouts guard admin-only pages: `/settings/*` → R1 only, `/users` → R1 only, `/service-centers` → R1+R2 only
- API guards: `requireRole("R1")` on all admin mutations (users, ticket-statuses, sub-statuses)
- `GET /api/sub-statuses/next` filters by `allowedRoles` (Admin bypasses)
- `PATCH /api/tickets/[id]/sub-status` enforces `allowedRoles` per sub-status (Admin bypasses)
- Files: `src/lib/auth-guard.ts`, `src/app/(protected)/*/layout.tsx`, all API mutation routes

### 2026-04-18 — Duplicate sub-status bug fix
- Root cause: PostgreSQL treats `(NULL, SS1)` as not equal to another `(NULL, SS1)` in unique constraints, so `skipDuplicates: true` didn't prevent duplicate entry-point transitions
- Fix: migration 0005 — deletes duplicates, recreates index with `NULLS NOT DISTINCT` (PG 15+)
- API also deduplicates with a `Set` as safety layer
- Files: `prisma/migrations/0005_fix_null_transitions/migration.sql`, `src/app/api/sub-statuses/next/route.ts`

### 2026-04-18 — Per-parent triggerMap (replaces global triggerStatusId)
- `TicketSubStatus.triggerStatusId` removed; replaced with `triggerMap Json` (e.g. `{ "S2": "S3" }`)
- Each sub-status can auto-advance the ticket to a *different* target status depending on which parent status the ticket is currently in
- Migration 0004 applied; seed updated; all API routes updated
- Files: `prisma/schema.prisma`, migrations 0004, `src/seed.ts`, API routes, settings page, `StatusUpdateCombined`

### 2026-04-18 — Sub-status system (SS1–SS35)
- 35 sub-statuses covering: customer comms, quote/approval, parts, QC, escalation, no-fix, ready
- Transition graph (null = entry point, like main statuses)
- `allowedRoles` = who can set it; `notifyRoles` = who gets notified when it's set
- Settings page: parent-wise layout, create/edit/delete/flow editor — admin only
- `StatusUpdateCombined` modal: single "Update Status" button, two tabs (within stage / advance stage)
- Files: `prisma/schema.prisma`, `src/seed.ts`, `src/app/(protected)/settings/sub-statuses/page.tsx`, `src/components/StatusUpdateCombined.tsx`

### 2026-04-17 — Core ticket flow
- 9 main statuses: S1 Received → S2 Diagnosing → S3 Repairing → S4 Escalated → S5 Received Back → S6 Ready → S7 Returned | S8 Closed-No Fix | S9 Cancelled
- Ticket CRUD, customer + device management, technician assignment
- Service centers (for escalation), priorities (P1–P4), ticket logs (timeline)
- Print receipt, reopen ticket, escalate to service centre flow
- In-app notification bell (polls every 30s, unread badge, mark as read)
- Files: all of `src/app/(protected)/tickets/`, `src/components/NotificationBell.tsx`

---

## 🔄 In Progress

- Nothing actively in progress

---

## 📋 Next Up (Prioritized)

1. **Reporting dashboard** — ticket counts by status over time, technician performance (average repair time), revenue (estimated cost sum), weekly/monthly charts. Use Recharts or similar.
2. **Customer SMS/email templates** — when front desk marks "Customer Called" or "Quote Sent", optionally send a template message. Needs integration choice (Twilio, Resend, etc.).
3. **Ticket search improvements** — full-text search across customer name, phone, device model, notes. Currently client-side filter only; needs server-side for large datasets.
4. **Technician time tracking** — log how long each ticket spends in each status. Derived from TicketLog timestamps.
5. **Bulk actions on ticket list** — select multiple tickets to reassign technician or change status in bulk.
6. **Customer portal (future)** — read-only view for customers to check their ticket status via a link. Out of scope for now.

---

## 🎨 UX Improvement Backlog

> Audited 2026-04-18. Ordered by impact on daily workflow.

### 🔴 High Priority (workflow-blocking friction)

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| U1 | All destructive deletes use browser `confirm()` — no context on dependencies | customers, users, service-centers, settings pages | Replace with styled modal showing related record counts; block delete if dependencies exist |
| U2 | Duplicate "Name" column in customers table | `customers/page.tsx` L144–155 | Remove the duplicate column; keep only the linked name |
| U3 | No confirmation before ticket escalation | `TicketEscalation.tsx` | Add confirm modal showing: ticket ID, service center, external ref, escalation date |
| U4 | Ticket detail `grid-cols-3` breaks on mobile — Actions panel unreachable | `tickets/[id]/page.tsx` L116 | Change to `grid-cols-1 md:grid-cols-3`; sticky action bar on mobile |
| U5 | Ticket escalation button hidden with no explanation when conditions not met | `tickets/[id]/page.tsx` L260 | Always render button, disable with tooltip: "Already escalated" or "Ticket is closed" |
| U6 | Reopen ticket modal doesn't show which ticket ID is being reopened | `TicketReopenButton.tsx` L61 | Show ticket ID prominently ("Reopening Ticket #123") in modal header |

### 🟡 Medium Priority (daily friction points)

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| U7 | "Unassigned" technician shown as plain grey text — not visually distinct | `tickets/[id]/page.tsx` L244 | Show as coloured badge (amber/red) with hint "Click to assign" |
| U8 | StatusUpdateCombined loads sub-statuses before showing anything — user sees blank modal | `StatusUpdateCombined.tsx` L177 | Show main status options immediately; load sub-statuses progressively |
| U9 | No pagination or sort on ticket list — all tickets fetched at once | `tickets/page.tsx` | Add server-side pagination; make column headers sortable; show "X of Y tickets" |
| U10 | Empty search results give no actionable suggestion | `tickets/page.tsx` L237, `customers/page.tsx` L121 | Add CTA in empty state: "Clear filters" or "Create new ticket/customer" |
| U11 | Success toasts don't confirm *what* changed — just "Status updated" | `StatusUpdateCombined.tsx` L111 | Show new status label: "Status updated → Repairing" |
| U12 | Dashboard action queue uses hardcoded `ACTION_LABELS` keyed by sub-status ID | `dashboard/page.tsx` | Add `actionLabel` field to `TicketSubStatus` model; settings page can edit it per sub-status |
| U13 | Customer detail page has no "Edit Customer" button — must navigate to list | `customers/[id]/page.tsx` | Add "Edit Customer" button in detail sidebar that opens edit modal with pre-filled data |
| U14 | Technician "Waiting: Front Desk / Despatch" indicators have no tooltip explaining required action | `dashboard/page.tsx` | Add tooltip or expand-on-hover with action description |
| U15 | No skeleton/error boundary when ticket detail fails to load | `tickets/[id]/page.tsx` L85 | Show loading skeleton; distinguish 404 (not found) from 500 (retry button) |
| U16 | Ticket list has no sort — newest tickets not guaranteed to appear first | `tickets/page.tsx` | Sort by `createdAt desc` by default; add sort controls per column |

### 🟢 Low Priority (polish & consistency)

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| U17 | No SLA timer or time-elapsed shown on tickets | ticket list + detail | Show "3 days in Diagnosing" on both list row and detail page; flag with amber/red after threshold |
| U18 | Sub-status badge shown next to main status with no visual relationship indicator | `tickets/[id]/page.tsx` | Add chevron arrow between main and sub-status badges (e.g. "Repairing → Waiting for Parts") |
| U19 | "Print Receipt" button buried at bottom of sidebar | `tickets/[id]/page.tsx` L270 | Move to top of actions panel; add `Ctrl+P` hint |
| U20 | Dates use `toLocaleDateString()` — ambiguous when day/month could swap (US vs UK locale) | multiple pages | Use unambiguous format: "18 Apr 2026" everywhere |
| U21 | Empty state messaging inconsistent across pages; users page shows nothing | multiple pages | Standardise: icon + headline + description + CTA button for all empty states |
| U22 | Badge colours have no legend or tooltip — new staff must guess meaning | all status/priority badges | Add tooltip-on-hover: "P1 = Critical — respond within 2 hours" |
| U23 | Long ticket form has no progress/section indicator | `TicketForm.tsx` | Divide into labelled sections (Customer → Device → Problem → Internal Notes) with visible section headers |
| U24 | Customer detail shows tickets per-device only; no cross-device recent history | `customers/[id]/page.tsx` | Add "Recent Tickets" section at top spanning all devices, sorted by date desc |
| U25 | All icon buttons missing `aria-label` | all components | Add `aria-label` to every icon-only button (Edit, Delete, View, etc.) |
| U26 | Modals don't trap focus or return focus to trigger on close | all modals | Use Radix `Dialog` primitive or add manual `focus-trap`; auto-focus first field on open |
| U27 | Role-specific ticket detail: all roles see same layout including irrelevant sections | `tickets/[id]/page.tsx` | Hide escalation info for Technician; hide full timeline for Front Desk (show summary only) |

### ⚡ Quick Wins (< 1 hour each)

1. **U2** — Remove duplicate Name column in customers table (2 line delete)
2. **U11** — Include new status label in success toast (1 line change)
3. **U4** — Add `md:` breakpoint to ticket detail grid (1 class change)
4. **U20** — Create a `formatDate(d)` utility and use it everywhere (30 min)
5. **U18** — Add chevron between status badges (5 min)
6. **U19** — Move Print Receipt button to top (2 line move)

---

## 💡 Ideas & Notes

- 2026-04-18 **Quick ticket creation**: QuickTicketButton component already exists — review if it handles all required fields
- 2026-04-18 **SLA alerts**: Flag tickets that have been in the same status for too long (e.g. "Diagnosing for 5+ days") — show in dashboard
- 2026-04-18 **Despatch courier integration**: Auto-generate tracking label from SS22 "Pending Despatch" — integrate with a courier API
- 2026-04-18 **Sub-status role display in modal**: The `ACTION_LABELS` map in the dashboard is hardcoded — consider making action descriptions a field on TicketSubStatus model itself (tracked as U12 above)

---

## ⚠️ Known Issues & Gotchas

- **Next.js 16 breaking changes**: Middleware file is `src/proxy.ts` NOT `middleware.ts`. Routes/APIs may differ from training data — always read `node_modules/next/dist/docs/` before writing Next.js code.
- **Prisma adapter-pg**: Uses `@prisma/adapter-pg` not standard prisma client. Datasource configured via `prisma.config.ts`.
- **NextAuth v5 beta**: `useSession()` on client returns `session.user` without `id`/`role` unless type-augmented. Always cast: `(session.user as { id?: string; role?: string })`.
- **No `getToken()` usage**: Hard rule — never use `getToken()` from next-auth/jwt. Use `auth()` server-side or `useSession()` client-side.
- **Scalar list filtering in Prisma**: `String[]` fields filter with `{ has: "R3" }` — works on PostgreSQL, not SQLite.
- **Sub-status allowedRoles**: Admin (R1) bypasses `allowedRoles` restriction by design. This is intentional — admin can set any sub-status.
- **Opaque IDs**: Status IDs are S1–S9, sub-statuses SS1–SS35, roles R1–R4, priorities P1–P4. These are stored as strings, not enums. Adding new ones via seed or settings page auto-increments.

---

## 🧠 Key Decisions Log

| Decision | Chosen | Alternatives Considered | Reason |
|----------|--------|------------------------|--------|
| Auth | NextAuth v5 JWT | Clerk, custom JWT | Free, open source, fits stack |
| Status IDs | Opaque strings (S1-S9) | Enums, UUIDs | Readable, stable, no migration needed for renames |
| Sub-status trigger | `triggerMap Json` per sub-status | Separate trigger join table | Simpler for internal tool; JSON stores per-parent target; no FK constraints needed |
| Entry-point transitions | `fromSubStatusId = null` | Separate `isEntryPoint` boolean | Mirrors main status transition graph pattern consistently |
| Null uniqueness | `NULLS NOT DISTINCT` index (PG 15) | Sentinel value, dedup in code | Cleanest DB-level constraint; dedup in code as backup |
| Role system | String IDs (R1-R4) | Enums, separate permissions table | Simple, works with Prisma `String[]` scalar lists |
| Dashboard approach | Server components per role | Client-side + API | No extra API route, no client fetch, faster render |
| changedBy in logs | Server session `auth()` | Client-sent body field | Client can send wrong/null userId; server session is authoritative |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── (protected)/           # All authenticated pages
│   │   ├── dashboard/         # Role-specific dashboards (server component)
│   │   ├── tickets/           # Ticket list + detail pages
│   │   ├── customers/         # Customer management
│   │   ├── service-centers/   # Service centre CRUD (Admin+Tech only)
│   │   ├── users/             # User management (Admin only)
│   │   └── settings/
│   │       ├── statuses/      # Main status settings (Admin only)
│   │       └── sub-statuses/  # Sub-status settings with flow editor (Admin only)
│   ├── api/
│   │   ├── tickets/           # Ticket CRUD + sub-status + reopen
│   │   ├── sub-statuses/      # Sub-status CRUD + transitions + next
│   │   ├── ticket-statuses/   # Main status CRUD + transitions
│   │   ├── users/             # User CRUD (Admin only)
│   │   ├── customers/         # Customer CRUD
│   │   ├── service-centers/   # Service centre CRUD
│   │   ├── notifications/     # In-app notification read/mark
│   │   ├── priorities/        # Priority list
│   │   └── roles/             # Role list
│   └── login/                 # Public login page
├── components/
│   ├── StatusUpdateCombined.tsx   # Single modal: sub-status + main status update
│   ├── NotificationBell.tsx       # Polling bell + unread badge
│   ├── Sidebar.tsx                # Role-filtered navigation
│   ├── QuickTicketButton.tsx      # Floating quick-create button
│   └── SessionWrapper.tsx         # NextAuth session provider
├── lib/
│   ├── prisma.ts              # Prisma client singleton
│   └── auth-guard.ts          # requireAuth() / requireRole() helpers
├── auth.ts                    # NextAuth config (JWT, credentials provider)
├── auth.d.ts                  # Session type augmentation (id, role on user)
├── proxy.ts                   # Auth middleware (Next.js 16 — NOT middleware.ts)
└── seed.ts                    # Full DB seed (statuses, sub-statuses, transitions, users)
prisma/
├── schema.prisma              # Full DB schema
├── prisma.config.ts           # Adapter-pg datasource config
└── migrations/                # 0001_init → 0005_fix_null_transitions
```

---

## 🔗 External Resources

- **Supabase project**: PostgreSQL database (aws-1-ap-south-1.pooler.supabase.com)
- **Next.js 16 docs**: `node_modules/next/dist/docs/` — read before writing any Next.js code
- **NextAuth v5 docs**: https://authjs.dev/
- **Prisma docs**: https://www.prisma.io/docs/
