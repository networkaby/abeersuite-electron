# Service Management System

Internal service management platform for an electronics repair business.

The app manages ticket lifecycle, ownership handoffs, role/permission-based access,
customer and company records, branch/department structure, internal inbox, and
finance modules.

## Current Stack

- Next.js `16.2.3` (App Router)
- React `19`
- Prisma `7.7.0` with PostgreSQL (`@prisma/adapter-pg`)
- NextAuth `5.0.0-beta.30` (Credentials + JWT sessions)
- Tailwind CSS v4 + shadcn/ui
- Supabase Realtime (`@supabase/supabase-js`) for inbox updates
- Sentry (`@sentry/nextjs`)
- Razorpay (payment gateway for shop checkout)
- Cloudinary (`next-cloudinary`) for product image uploads
- Zod + React Hook Form
- Zustand for client-side state (cart, wishlist, compare, quick-ticket)
- Package manager: `pnpm`

## Repository Conventions

- Use `pnpm` (not npm/yarn) for install and scripts.
- Keep pages SSR by default; mark interactive pieces as client components.
- Use `next/image` (`<Image />`) instead of `<img>`.
- Currency convention in this workspace is `₹`.
- Next.js 16 note: auth middleware is in `src/proxy.ts` (not `middleware.ts`).

## Project Layout

See `ARCHITECTURE.md` for full details.

High-level:

- `src/app/(protected)/layout.tsx` — staff shell (auth); child routes under **`office/`** → browser URLs **`/office/*`** (tickets, customers, tally, inbox, admin, …)
- `src/app/(protected)/office/*` is fully flattened — each subdirectory is a real URL segment: `admin/`, `core/`, `customers/`, `crm/`, `message/`, `repairing/`, `social/`, `accountancy/`, `ecommerce/`, `inventory/`, `roadmap/`
- `src/app/(external)/*` route groups: store homepage, shop (`/shop/*`), customer portal (`/portal/*`) — **not** under `/office`
- Sign-in URLs: customer **`/login`** (`src/app/(external)/login/page.tsx`), staff **`/staff/login`** (`src/app/staff/login/page.tsx`). Legacy **`/portal/login`** redirects to **`/login`** in `src/proxy.ts`.
- `src/app/api/*` route handlers (staff API + public shop/portal API)
- `src/modules/*` domain modules (`core`, `customer`, `external`, `inventory`, `message`, `repairing`, `shared`, `tally`)
- `src/shared/*` cross-cutting components, hooks, lib (api, schemas, constants, prisma, auth, format, shop, portal, supabase), types
- `src/store/*` Zustand stores (staff: quickTicket, reference; external: cart, wishlist, compare)
- `prisma/schema/*` split Prisma schema files

## Finance (Tally Context)

The finance module under `(protected)/office/(tally)/tally/` (URLs **`/office/accountancy/*`** — renamed from `/office/finance/*` on 2026-05-07) is accounting-oriented and intentionally maps Tally-style thinking into a cleaner software model:

- `AccountType` = top-level accounting class (`ASSET`, `LIABILITY`, `INCOME`, `EXPENSE`)
- `AccountGroup` = category bucket (for example, debtors, creditors, cash, expenses)
- `Ledger` = actual ledger account used in journal/invoice/payment entries

Vouchers under `/office/accountancy/`: sales, purchases, estimates, journal, inventory (receipt/issue/transfer/adjust). Reports: cash-book, bank-book, bank-reconciliation, cash-flow, fund-flow, ratio-analysis, statistics, receivables, payables, ledger-outstandings, GST hub (HSN summary, inward/outward supplies, liability).

GST: `Customer` and `Company` carry `gstin`, `gstStateCode`, `gstRegType` (REGULAR/COMPOSITION/SEZ/UNREGISTERED), `financialYearFrom`, `booksBeginningFrom`. `InvProduct` carries `hsnCode`, `gstRate`, `taxability`. Vouchers use `PartyCombobox` (`src/modules/tally/components/PartyCombobox.tsx`) for searchable party selection with GST autofill.

Design intent: keep Tally familiarity (groups + ledgers) while preserving a clean relational model for reporting and automation.

## Quick Start

1) Install dependencies:

```bash
pnpm install
```

2) Configure environment in `.env.local` (or `.env`):

```bash
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
AUTH_SECRET=...
NEXTAUTH_SECRET=...

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
NEXT_PUBLIC_RAZORPAY_KEY_ID=...

NEXT_PUBLIC_SENTRY_DSN=...
```

3) Generate Prisma client and run schema sync:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

4) Seed data:

```bash
pnpm exec prisma db seed
```

5) Run dev server:

```bash
pnpm dev
```

## Scripts

- `pnpm dev` - start Next dev server
- `pnpm build` - generate Prisma client and build app
- `pnpm start` - run production server
- `pnpm lint` - run ESLint

## Prisma Notes

- Prisma uses split schema mode via `prisma.config.ts`:
  - schema path: `prisma/schema`
  - datasource URL: `DIRECT_URL` fallback to `DATABASE_URL`
- Seed command is configured to run:
  - `pnpm exec tsx src/new-seed.ts`
- After schema changes, restart dev server to avoid stale Prisma client chunks in Turbopack.

## Authentication and Authorization

- NextAuth config is in `src/auth.ts`.
- JWT/session include user context such as roles, permissions, rank, scope, branch, and department.
- Route-level auth redirect logic is in `src/proxy.ts` (guests hitting **`/office/*`** go to **`/staff/login`**; other protected paths go to **`/login`**; staff home after sign-in: **`/office/work-flow-inbox`**).
- API and server-side permission checks are implemented with `requireAuth` / `requirePermission` helpers.

## Known Operational Gotchas

- Do not use `getToken()`-based custom middleware for NextAuth v5 in this repo.
- `src/proxy.ts` is the active middleware entry in Next.js 16.
- Sentry example routes/pages are for testing and should be removed/disabled for production if not needed.

## Backup Schedule

Backups are dumped by a GitHub Actions runner (Vercel functions have no
`pg_dump`) and uploaded to Dropbox. Three things can start one, and the dump's
file name records which:

```
smx-backup-office.networkservice.in-gphtzbejvpijcfmvqpqo-manual-2026-09-02-000045-IST.dump
            └─ where from ────────┘ └─ which database ──┘ └ how ┘ └─ when (IST) ──┘
```

| Source | Started by | Schedule lives in |
|---|---|---|
| `manual` | **Back up now**, Settings → Backup & Restore | — |
| `cron` | Vercel Cron → `/api/cron/backup` | `vercel.json` |
| `git` | GitHub Actions | `.github/workflows/backup.yml` |

### Right now: Vercel cron is OFF

`vercel.json` ships with an empty `crons` array, so Vercel starts no backups.
**Automatic backups still happen** — the GitHub schedule runs daily at 09:00 UTC
(14:30 IST) and does not depend on Vercel, on the app being up, or on the
database being reachable from the app. That independence is the point: it is the
one that still works when the deployment is broken.

### To start daily midnight backups — copy this

Replace the whole of `vercel.json` with this, commit, and push. Vercel picks up
the schedule on the next deploy; nothing else needs changing.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["bom1"],
  "crons": [{ "path": "/api/cron/backup", "schedule": "30 18 * * *" }]
}
```

`30 18 * * *` is 18:30 UTC = **00:00 IST**, i.e. midnight tonight, every night.
Cron has no timezone setting, so the time is always written in UTC.

Before pushing, check two things:

1. **`CRON_SECRET` is set** in the Vercel project's environment variables. The
   route only checks the Authorization header when that variable exists — unset,
   anyone who knows the URL can trigger a backup.
2. **`DIRECT_URL` is set** in the same place, holding the direct Postgres URL
   (port 5432, no `pgbouncer=true`). The pooled URL fails: `pg_dump` rejects
   connection parameters it does not recognise, and the run uploads a 0-byte
   dump.

To stop Vercel backups again, set `"crons": []` and deploy.

#### What to expect on the free plan

This project is on Vercel **Hobby**, which limits cron jobs to:

- **2 cron jobs** per project.
- **Once per day** each — no hourly or twice-daily schedule.
- Fired **within the hour** of the stated time, not exactly on it. A midnight
  backup may actually run any time between 00:00 and 01:00 IST. For a backup
  that is fine; do not build anything time-critical on it.

So on the night you switch this on, expect the dump to appear in Dropbox
somewhere in that window, named:

```
smx-backup-<your-domain>-gphtzbejvpijcfmvqpqo-cron-2026-09-02-0007xx-IST.dump
```

Times in the file name and in `backup-log.txt` are **Indian time**, marked `IST`.
Dumps taken before 1 September 2026 carry an unmarked **UTC** stamp instead — for
those, add 5:30 to get Indian time. The `IST` suffix is how you tell the two
apart.

### Setting a different Vercel cron time

Edit the `schedule` field above. Fields are
`minute hour day-of-month month day-of-week`, day-of-week runs `0`–`6` from
Sunday, and the time is **always UTC** — subtract 5:30 from IST:

| Wanted (IST) | UTC | `schedule` |
|---|---|---|
| Midnight daily | 18:30 previous day | `30 18 * * *` |
| 2:30 AM daily | 21:00 previous day | `0 21 * * *` |
| 11:30 PM daily | 18:00 | `0 18 * * *` |
| 5:30 AM daily | 00:00 | `0 0 * * *` |
| Midnight Sundays | 18:30 Saturday | `30 18 * * 6` |

**Do not set an hourly tick** (`0 * * * *`) — quite apart from Hobby rejecting
it, `/api/cron/backup` dispatches on every tick with no schedule check of its
own, so an hourly cron would mean 24 full dumps a day. Per-hour control is what
the unfinished in-app schedule UI is for — see
`docs/backup-schedule-activation.md`.

### Setting the GitHub schedule

In `.github/workflows/backup.yml`, under `on: schedule:`. Same UTC cron syntax.
A scheduled run takes no inputs — it reads the `DIRECT_DATABASE_URL` repo secret
and builds its own file name. That secret must be the **direct** URL (port 5432,
no `pgbouncer=true`); the pooled URL fails, because `pg_dump` rejects unknown
connection parameters.

## Documentation Map

- `ARCHITECTURE.md` — current architecture and module boundaries (present-tense).
- `PROJECT_BRAIN.md` — aim, what's in flight, recently shipped, next up, decisions, gotchas. **The only doc with status.**
- `AGENTS.md` — contributor rules.
- `docs/modules/<module>.md` — per-module reference (URLs, permissions, models, key components, gotchas).
- `docs/completed-and-protected.md` — behaviour-guarded surfaces (accounting math, POS GL, BS/P&L/Day Book).
- `docs/seeds.md` — seed lifecycle (bootstrap / dummy / hard-clean).
- `docs/backup-schedule-activation.md` — switching on the in-app backup schedule UI (built, not live).
