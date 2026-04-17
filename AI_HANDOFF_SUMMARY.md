# AI Handoff Summary — Service Management System
*Created: April 17, 2026 — To be read alongside ServiceMgmt_Blueprint.docx*

---

## Context for the New Session

This is the third attempt at a repair shop service management system. The previous two repos (`service-mgmt-old`, `service-mgmt`) were abandoned due to specific bugs, not architectural problems. All three repos are essentially the same codebase. **The active repo is `service-mgmt-experiment` at `D:\our-own-website\service-mgmt-experiment`.**

The blueprint document (`ServiceMgmt_Blueprint.docx` in this folder) contains the full detail. This summary gives you what you need to start working immediately.

---

## The App

**What it is:** A repair shop service management system for an electronics repair business.

**Users:** Front Desk staff (intake, customer calls), Technicians (diagnosis, repair), Admins (user management).

**NOT in scope:** Spare parts inventory, billing/invoicing (client has existing software for both).

---

## Tech Stack

- Next.js 16.2.3 (App Router) + React 19
- PostgreSQL (Supabase) + Prisma 7.7.0 with serverless pool adapter
- NextAuth v5 beta (5.0.0-beta.30) — JWT, credentials provider
- shadcn/ui + Tailwind CSS v4 (no tailwind.config.js — uses `@theme` inline)
- React Hook Form + Zod (imported as `zod/v3`)
- TypeScript strict mode
- pnpm

**Important gotchas:**
- Prisma client is generated to `src/generated/prisma` (non-standard path)
- Tailwind v4 — no separate config file
- NextAuth v5 — do NOT write a custom `middleware.ts` using `getToken()` from `next-auth/jwt` (this is what broke the previous repos on Vercel). Use the built-in `auth()` method only.
- `AGENTS.md` in the repo notes that Next.js 16 has breaking API changes vs older versions — check `node_modules/next/dist/docs/` before writing new route handlers.

---

## What Is Already Built and Working

**Pages:** Landing, Login, Dashboard (stats + recent tickets), Customers (list + detail), Tickets (list + detail with full timeline), Users, Service Centers, Printable thermal receipt (80mm, `/receipt/[id]`)

**API routes:** Full CRUD for customers, tickets, users, service centers + a reopen endpoint

**Key features working:**
- QuickTicketButton — floating 3-step modal: phone lookup → create customer if not found → create ticket → auto-opens receipt. Primary intake flow. Do not break this.
- TicketLog audit trail — every status change logged with user + timestamp + note
- Escalation fields on Ticket: `escalatedAt`, `expectedReturn`, `receivedBackAt`, `externalRef`
- Thermal receipt page — print CSS, 80mm, signature lines

**Current status pipeline (hardcoded in `TicketStatusUpdate.tsx` as `NEXT_STATUSES`):**
```
RECEIVED → DIAGNOSING → REPAIRING → ESCALATED → RECEIVED_BACK → READY → RETURNED
```

---

## Known Bugs (fix in Phase 1)

| Bug | Location |
|-----|----------|
| Duplicate customer name column | `src/app/(protected)/customers/page.tsx:141` |
| `TicketReopenButton` built but orphaned | `src/components/TicketReopenButton.tsx` — not imported anywhere |
| Old ticket creation button commented out | `src/app/(protected)/tickets/page.tsx:142` — dead code to clean up |
| `agreedToTerms` field in schema, never shown in UI | Customer model + all customer forms |
| Currency hardcoded (৳) | `src/app/receipt/[id]/page.tsx` + multiple places |
| Zustand installed, never used | `package.json` — dead dependency |
| Customer delete has no integrity check | `src/app/api/customers/[id]/route.ts` — silently cascades. Users API has this check; customers don't. |

---

## Critical Security Gaps (fix in Phase 1 before any user testing)

1. **All `/api/*` routes are publicly accessible** — no authentication check on any endpoint
2. **Roles (ADMIN/TECHNICIAN/FRONT_DESK) are stored but never enforced** — any caller can hit any endpoint
3. **No server-side Zod validation** on API request bodies — handlers trust input completely

---

## The Core Design: Two-Layer Status System

This is the most important feature to build. It was designed in a prior session because the original linear pipeline was too rigid for real-world repair operations.

### Layer 1 — Primary Status (the pipeline)
Always moves forward. Never goes backward except on reopen.

| Status | Terminal? |
|--------|-----------|
| RECEIVED | No |
| DIAGNOSING | No |
| REPAIRING | No |
| ESCALATED | No |
| READY | No |
| RETURNED | Yes |
| RETURNED_WITHOUT_FIX | Yes (new — must add to enum) |

`RETURNED_WITHOUT_FIX` can be reached from DIAGNOSING, REPAIRING, or ESCALATED — device exits the pipeline unfixed at any point.

### Layer 2 — Sub-Status (current state within a stage)
Applied at ANY primary status without breaking the pipeline. Answers "what is actually happening right now inside this stage?"

**The key insight: sub-status assigns responsibility to a role.** This creates a handoff system between Front Desk and Technician without needing notifications.

| Sub-Status | Owner Role |
|------------|-----------|
| Active | Technician (default, no hold) |
| Waiting for Customer Reply | Front Desk |
| Customer Replied | Technician |
| Waiting for Parts | Front Desk |
| Parts Arrived | Technician |
| Needs Escalation | Front Desk |
| Waiting for Shipment | Front Desk |
| Shipped | Front Desk |
| Waiting Service Centre | Front Desk |
| Received Back Fixed | Technician |
| Received Back Unfixed | Technician |
| Waiting Customer Pickup | Front Desk |

**Communication loop (replaces notifications for now):**
1. Technician sets sub-status (e.g. "Waiting for Customer Reply")
2. Front Desk sees "action required" badge on dashboard
3. Front Desk calls customer, adds note, sets sub-status to "Customer Replied"
4. Technician sees their action badge, resumes work, clears to "Active"

### Reopen Flow
When customer returns with same unresolved problem:
- Same ticket is reopened (no new ticket)
- Primary status → RECEIVED, sub-status → Active
- Full history preserved in timeline

---

## DB Schema Changes Required

These do NOT exist in the current repo yet:

```prisma
// New models to add:

model SubStatus {
  id          String   @id @default(cuid())
  key         String   @unique  // SS1, SS2... (opaque key)
  label       String
  ownerRole   Role     // FRONT_DESK or TECHNICIAN
  tickets     Ticket[]
  allowedOn   SubStatusOnStatus[]
}

model StatusTransition {
  id          String  @id @default(cuid())
  fromStatus  String  // S1, S2... (opaque key matching TicketStatus enum values)
  toStatus    String
}

model SubStatusOnStatus {
  id            String    @id @default(cuid())
  subStatusId   String
  primaryStatus String    // which primary status this sub-status is valid on
  subStatus     SubStatus @relation(fields: [subStatusId], references: [id])
}

// Add to Ticket model:
subStatusId   String?
subStatus     SubStatus? @relation(fields: [subStatusId], references: [id])

// Add to TicketStatus enum:
RETURNED_WITHOUT_FIX
```

**Why opaque keys:** Status names (S1, S2 / SS1, SS12) are meaningless so labels can change without code changes or migrations.

**Why DB-driven transitions:** `StatusTransition` table makes the pipeline configurable without code deploys. Long-term goal is a Settings UI where an admin can add/rename/reorder statuses.

---

## Dashboard Changes Required

Add two action counters to the dashboard:
- **Front Desk Action** — count of open tickets where `subStatus.ownerRole = FRONT_DESK`
- **Technician Action** — count of open tickets where `subStatus.ownerRole = TECHNICIAN`

This gives management instant visibility into who is the bottleneck.

---

## Agreed Build Plan (32 tasks across 5 phases)

### Phase 1 — Security & Stability (do this first, before anything else)
1. Add auth check to all `/api/*` routes
2. Enforce roles at API level per endpoint
3. Add Zod validation on all API request bodies
4. Add customer delete integrity check
5. Fix duplicate name column in customers table
6. Reconnect `TicketReopenButton` on ticket detail page
7. Clean up commented-out ticket creation code

### Phase 2 — Two-Layer Status System
8. Prisma schema: add SubStatus, StatusTransition, SubStatusOnStatus models
9. Prisma schema: add RETURNED_WITHOUT_FIX to status enum
10. Prisma schema: add subStatusId to Ticket
11. Seed DB with all sub-statuses (with owner roles) and all valid transitions
12. Replace hardcoded `NEXT_STATUSES` in TicketStatusUpdate.tsx with DB-driven transitions
13. Add sub-status selector to status update modal (filtered by primary status)
14. Show current sub-status on ticket detail page
15. Dashboard: add Front Desk Action and Technician Action counters
16. Dashboard: action list filtered/sorted by sub-status owner

### Phase 3 — Performance
17. Move ticket filtering to server-side (API query params)
18. Move customer search to server-side
19. Pagination on tickets list
20. Pagination on customers list

### Phase 4 — Features
21. Surface `agreedToTerms` checkbox in customer forms
22. Make currency configurable
23. Password reset flow
24. Customer notifications — ticket ready SMS/email
25. Real-time updates (polling, 30s interval as first step)
26. CSV/PDF export for ticket list
27. Settings module: admin UI for status/sub-status labels and transitions (Phase 2+)

### Phase 5 — Quality
28. Add `.env.example`
29. API route integration tests (real DB, no mocks)
30. Critical UI flow tests
31. CI/CD pipeline
32. Remove unused Zustand dependency

---

## Lessons from Previous Repos — Hard Rules

1. **Never write a custom `middleware.ts` using `getToken()` from `next-auth/jwt`** — this is what broke login on Vercel in the previous repos. Use `auth()` from NextAuth v5 only.
2. **Always match Prisma relation names exactly** — `ticket` vs `tickets` typo crashed all customer pages. Run `prisma generate` and check client types before testing.
3. **Never use TypeScript `any`** — the old repos masked runtime errors this way.
4. **Isolate bugs before restarting** — the two previous restarts were caused by two fixable bugs, not architectural failures.

---

## What Was Agreed NOT to Build

- Spare parts inventory — out of scope
- Billing/invoicing — client has existing software
- SMS/email notifications — later phase
- Full status UI configurability — Phase 2+ (DB-driven transitions are the foundation)

---

## Starting Point for New Session

The new session should:
1. Read this file + the blueprint (`ServiceMgmt_Blueprint.docx`) for full context
2. Ask the user which phase/task to start with
3. Start with Phase 1 (security) unless told otherwise
4. Do NOT rewrite — build on `service-mgmt-experiment` only

Repo path: `D:\our-own-website\service-mgmt-experiment`
