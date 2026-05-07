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
- `src/app/(protected)/office/*` route groups: `(admin)`, `(core)`, `(customer)`, `(message)`, `(repairing)`, `(social)`, `(tally)`, `(e-commerce)`, `(inventory)`
- `src/app/(external)/*` route groups: store homepage, shop (`/shop/*`), customer portal (`/portal/*`) — **not** under `/office`
- Sign-in URLs: customer **`/login`** (`src/app/(external)/login/page.tsx`), staff **`/staff/login`** (`src/app/staff/login/page.tsx`). Legacy **`/portal/login`** redirects to **`/login`** in `src/proxy.ts`.
- `src/app/api/*` route handlers (staff API + public shop/portal API)
- `src/modules/*` domain modules (`core`, `customer`, `external`, `inventory`, `message`, `repairing`, `shared`, `tally`)
- `src/lib/*` infrastructure, auth guards, shop helpers
- `src/store/*` Zustand stores (staff: quickTicket, reference; external: cart, wishlist, compare)
- `prisma/schema/*` split Prisma schema files

## Finance (Tally Context)

The finance module under `(protected)/office/(tally)/tally/` (URLs **`/office/tally/*`** — renamed from `/office/finance/*` on 2026-05-07) is accounting-oriented and intentionally maps Tally-style thinking into a cleaner software model:

- `AccountType` = top-level accounting class (`ASSET`, `LIABILITY`, `INCOME`, `EXPENSE`)
- `AccountGroup` = category bucket (for example, debtors, creditors, cash, expenses)
- `Ledger` = actual ledger account used in journal/invoice/payment entries

Vouchers under `/office/tally/`: sales, purchases, estimates, journal, inventory (receipt/issue/transfer/adjust). Reports: cash-book, bank-book, bank-reconciliation, cash-flow, fund-flow, ratio-analysis, statistics, receivables, payables, ledger-outstandings, GST hub (HSN summary, inward/outward supplies, liability).

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

SENTRY_DSN=...
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
- Route-level auth redirect logic is in `src/proxy.ts` (guests hitting **`/office/*`** go to **`/staff/login`**; other protected paths go to **`/login`**; staff home after sign-in: **`/office/assignments`**).
- API and server-side permission checks are implemented with `requireAuth` / `requirePermission` helpers.

## Known Operational Gotchas

- Do not use `getToken()`-based custom middleware for NextAuth v5 in this repo.
- `src/proxy.ts` is the active middleware entry in Next.js 16.
- Sentry example routes/pages are for testing and should be removed/disabled for production if not needed.

## Documentation Map

- `ARCHITECTURE.md` - current architecture and module boundaries
- `PROJECT_BRAIN.md` - decision log, milestones, roadmap notes
- `docs/customer-site-shared-imports.md` - cross-boundary import registry for `(external)/` surface
- `AI_HANDOFF_SUMMARY.md` - historical context from earlier phases (may be missing)
