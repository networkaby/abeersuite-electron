# Architecture Overview

This document describes the current implementation architecture of
`service-mgmt-experiment`.

## 1) Runtime Architecture

- **Framework**: Next.js App Router (`src/app`)
- **Rendering model**: SSR-first pages, client components for interactive UI
- **Auth middleware**: `src/proxy.ts`
- **API layer**: route handlers under `src/app/api/*`
- **Data layer**: Prisma + PostgreSQL
- **Realtime layer**: Supabase Realtime for inbox updates

## 2) Domain Boundaries

Core domain modules are in `src/modules`:

- `core` - shared business workflows (assignment-oriented pages/logic)
- `customer` - customer/company domain components and helpers
- `message` - inbox and messaging domain
- `repairing` - ticket lifecycle, repair workflow UI/domain
- `tally` - finance and accounting features
- `shared` - cross-domain reusable module-level pieces

App-level cross-cutting components remain in `src/components` (e.g. `Sidebar`,
`QuickTicketButton`, `UniversalCreateMenu`).

### Tally Domain Note

The `(tally)` domain is inspired by standard Tally workflows but modeled for
application clarity and long-term extensibility:

- group/category semantics are represented through account hierarchy
- ledger usage is represented as concrete account records used in entries
- reporting is generated from journal/invoice/payment data, not from UI-only state

## 3) App Route Groups

Protected app pages are grouped under `src/app/(protected)`:

- `(admin)` - users, roles, org/admin management pages
- `(core)` - assignments and cross-role operational views
- `(customer)` - customers and companies
- `(message)` - inbox
- `(repairing)` - dashboard, tickets, service centers, settings
- `(tally)` - finance flows

Route groups organize code without changing public URL structure.

## 4) API Topology

Main API areas:

- `/api/tickets/*` - lifecycle, status/sub-status, notes, reopen, assign, transfer
- `/api/ticket-statuses/*` and `/api/sub-statuses/*` - workflow configuration
- `/api/users/*`, `/api/roles/*`, `/api/permissions` - RBAC
- `/api/branches/*`, `/api/departments/*`, `/api/posts/*` - org structure
- `/api/customers/*`, `/api/companies/*`, `/api/accounts/*` - customer/company domain
- `/api/inbox/*` - room listing, read state, messages
- `/api/finance/*` - GL accounts, journal entries, invoices, reports

Validation is Zod-driven across most write endpoints. Auth and authorization are
enforced via guard helpers from `src/lib`.

## 5) Auth and Authorization Model

- NextAuth config lives in `src/auth.ts` (`Credentials` provider + JWT strategy).
- Sessions include role and permission context for server/UI decisions.
- API endpoints use:
  - `requireAuth` for authenticated access
  - `requirePermission` for fine-grained authorization

Current direction is permission-driven authorization rather than role-name checks.

## 6) Data Model and Prisma Layout

Prisma uses split schema mode:

- `prisma.config.ts` points to `prisma/schema`
- schema files include:
  - `base.prisma`
  - `users.prisma`, `rbac.prisma`, `org.prisma`
  - `pipeline.prisma`, `tickets.prisma`, `accounts.prisma`
  - `finance.prisma`, `inbox.prisma`, `social.prisma`, `enums.prisma`

This supports modular ownership of schema areas while sharing one datasource.

## 7) Important Design Decisions

- Ticket workflow supports primary status + sub-status style handoffs.
- Ownership model uses a primary owner plus participant helpers.
- Pipeline model allows multiple business workflows (repair/sales/etc).
- Customer and company are separated; account is retained as legacy bridge.
- Finance follows a Tally-style mental model, but normalized as
  `AccountType -> AccountGroup -> Account` to avoid tightly coupling to one tool's labels.

## 8) Operational Notes

- Use `pnpm`.
- After Prisma schema updates, run `prisma generate` and restart dev server.
- On Next.js 16, do not move auth middleware logic to `middleware.ts`; keep `src/proxy.ts`.

## 9) Documentation Boundaries

- Use this file for code-current architecture.
- Use `PROJECT_BRAIN.md` for milestones, decisions, and roadmap.
- Use `AI_HANDOFF_SUMMARY.md` as historical context from earlier iterations.
