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
| `git` | GitHub Actions, hourly | Settings → Backup & Restore |

### Where backups come from

`vercel.json` ships with no `crons`, so Vercel starts nothing. Automatic backups run
from GitHub Actions, which is free, unlimited in schedule count, and — the deciding
argument — keeps working when the deployment does not.

Vercel Cron is still wired up (`/api/cron/backup`) if you ever want a backup
triggered *through* the app, so that it uses the deployment's own `DIRECT_URL`
rather than the repo secret. It is not needed for ordinary scheduled backups, and on
the free plan it is a poor fit anyway: Hobby allows 2 cron jobs, once a day each,
fired at an approximate time within the hour. To use it, add a `crons` array to
`vercel.json` with a UTC schedule and deploy. Cron has no timezone, so subtract 5:30
from the IST time you want:

| Wanted (IST) | UTC | `schedule` |
|---|---|---|
| Midnight daily | 18:30 previous day | `30 18 * * *` |
| 10:00 AM daily | 04:30 | `30 4 * * *` |
| 10:00 PM daily | 16:30 | `30 16 * * *` |
| 10:00 PM Sundays | 16:30 Sunday | `30 16 * * 0` |

### The automatic backup — set from the settings page

Days, times and the on/off switch all live in Settings → Backup & Restore. Changes
take effect on the next hourly tick — no commit, no redeploy.

`backup-scheduled.yml` fires hourly and asks the app whether that hour is one you
picked; almost every tick therefore does nothing and ends in seconds. The times you
choose are IST, and hours are the finest granularity available, since the tick is
hourly.

Two crons live in that file, and neither is the schedule:

```yaml
on:
  schedule:
    - cron: "0 * * * *"     # the tick — gated by the app
    - cron: "30 16 * * 0"   # Sunday 22:00 IST — always runs, gate or no gate
```

The Sunday run is the safety net. The gate fails closed, so an app outage would
otherwise stop backups silently; this bounds the worst case at one backup a week
rather than none. Failing open was the alternative, and it would turn one outage
into 24 full dumps a day.

Setup steps, secrets and verification are in
`docs/backup-schedule-activation.md`.

#### Cost of running it often

Every run is a full `pg_dump` — there are no incremental backups, and nothing
deletes old dumps. Three things to watch as the database grows:

- **Supabase egress.** The dump is compressed *after* leaving the database, so a
  1 MB file is more like 5–10 MB of metered egress. Five a day is roughly
  0.8–1.5 GB/month against 5 GB on the free plan.
- **Dropbox space.** No retention policy exists yet.
- **Actions minutes.** About 2 minutes per real run; a skipped tick costs seconds.

#### What a scheduled run does differently

It takes no inputs. It reads the `DIRECT_DATABASE_URL` **repo secret** and builds
its own file name (`…-git-<timestamp>-IST.dump`). Two consequences:

- That secret must hold the **direct** URL — port 5432, no `pgbouncer=true`. The
  pooled URL fails: `pg_dump` rejects connection parameters it does not recognise
  and the run writes a 0-byte dump.
- Because it is a secret rather than a workflow input, the password is masked in
  the run log. Backups triggered from the app pass the URL as an input, which
  GitHub echoes in full — so the scheduled path is also the safer one.

#### Two GitHub-specific traps

- **Scheduled runs start late.** GitHub queues them, usually by minutes and
  sometimes much more at the top of the hour. Treat the times as "around".
- **Schedules are disabled after 60 days without repository activity.** GitHub
  emails first, and the settings page shows this as a distinct reason. Turning the
  switch back on fixes it.

## Documentation Map

- `ARCHITECTURE.md` — current architecture and module boundaries (present-tense).
- `PROJECT_BRAIN.md` — aim, what's in flight, recently shipped, next up, decisions, gotchas. **The only doc with status.**
- `AGENTS.md` — contributor rules.
- `docs/modules/<module>.md` — per-module reference (URLs, permissions, models, key components, gotchas).
- `docs/completed-and-protected.md` — behaviour-guarded surfaces (accounting math, POS GL, BS/P&L/Day Book).
- `docs/seeds.md` — seed lifecycle (bootstrap / dummy / hard-clean).
- `docs/backup-schedule-activation.md` — switching on the in-app backup schedule UI (built, not live).
