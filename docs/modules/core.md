# Core (cross-module workspace)

> Catch-all pages that span more than one domain — the staff "homepage" for daily work. Assignments, call log, account look-up, serial-number search.

## URLs

### UI pages
- `/office/core/assignments` — staff post-login landing; ticket assignments per the user's scope. File: `src/app/(protected)/office/core/assignments/page.tsx`
- `/office/core/call-log` — inbound/outbound call records with follow-up tracking. File: `src/app/(protected)/office/core/call-log/page.tsx` + `CallLogFilters.tsx`
- `/office/core/accounts` — ledger accounts directory; filters by `personId` / `companyId`. File: `src/app/(protected)/office/core/accounts/page.tsx`
- `/office/core/accounts/[id]` — single account detail (transactions + balance). File: `src/app/(protected)/office/core/accounts/[id]/page.tsx`
- `/office/core/search-slno` — device serial-number search across tickets + warranty terms. File: `src/app/(protected)/office/core/search-slno/page.tsx`

### API routes
- `GET /api/accounts` — paged list with `personId` / `companyId` filter. Returns embedded primary phone via `selectPrimaryPhone`.
- `GET /api/accounts/[id]` — single account + balance + opening + linked person/company.
- `GET /api/call-logs` — paged list, status/direction/search filters.
- `POST /api/call-logs`, `PATCH /api/call-logs/[id]` — record + edit a call entry; tied to a ticket if relevant.
- `GET /api/search-slno`, `GET /api/search-slno/[deviceId]` — serial-number lookup; returns the device + linked tickets + warranty info.

## Permissions (gate keys)
- `assignments:view:own` / `assignments:view:branch` / `assignments:view:department` / `assignments:view:org` — assignments page filtering radius. Legacy `assignments:view-team` / `assignments:view-org` still recognised.
- No dedicated keys for the other pages; they fall back to `requireAuth()` (any logged-in staff).

## Prisma models
- `Account` (file: `prisma/schema/finance.prisma`) — GL ledger row; linked to `Person` or `Company` (XOR) for party ledgers, or to a chart-of-accounts entry (GL).
- `Device` (file: `prisma/schema/repair.prisma`) — serial-numbered hardware; surfaced via `/api/search-slno`.
- `TicketLog` (file: `prisma/schema/repair.prisma`) — also surfaces call-log entries via `kind = "CALL"` (currently `/api/call-logs` keeps a separate table — see gotchas).

## Key components
- The pages are largely self-contained — heavy `"use client"` files in `src/app/(protected)/office/core/`. Future extraction into `src/modules/core/components/` is planned (Segment 12) but hasn't run yet.

## Library / helpers
- None at present — `src/modules/core/` has no `lib/` (per Segment 10 audit, no domain logic to extract).

## Common workflows (wiring)
1. **Front-desk view assignments**: `/office/core/assignments` filters by `caller.scope` against ticket `branch`/`department`/`assigneeId` columns.
2. **Search a device**: `/office/core/search-slno` → typed serial → `GET /api/search-slno?q=…` → device + ticket history; click through to `/office/repairing/tickets/[id]`.
3. **Look up a customer's ledger**: `/office/core/accounts` filtered by `personId` → click → `/office/core/accounts/[id]` for the transaction list.

## Recent decisions / gotchas
- 2026-05-11: route group `(core)` promoted to real URL segment `core` (commit `30800af`). Previous URLs `/office/{accounts,assignments,call-log,search-slno}` now redirect to nothing — old bookmarks 404. Internal app, no compat redirect.
- Call log table (`CallLog`) is separate from the ticket-log-with-kind approach — historic split. Not yet unified.

## Out of scope / deferred
- Voice-call recording / transcript ingestion (would attach to `CallLog`).
- Cross-branch assignment routing (currently scope-based, manual).

_Last updated: 2026-05-11 — covers state after Segment 14 (API path rename) and the office route-group promotion._
