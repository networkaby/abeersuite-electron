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
- Zod + React Hook Form
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

- `src/app/(protected)/*` route groups: admin, core, customer, message, repairing, tally
- `src/app/api/*` route handlers
- `src/modules/*` domain modules (`core`, `customer`, `message`, `repairing`, `shared`, `tally`)
- `src/lib/*` infrastructure and auth guards
- `prisma/schema/*` split Prisma schema files

## Finance (Tally Context)

The finance module under `(tally)` is accounting-oriented and intentionally maps
Tally-style thinking into a cleaner software model:

- `AccountType` = top-level accounting class (`ASSET`, `LIABILITY`, `INCOME`, `EXPENSE`)
- `AccountGroup` = category bucket (for example, debtors, creditors, cash, expenses)
- `Account` = actual ledger account used in journal/invoice/payment entries

Design intent: keep Tally familiarity (groups + ledgers) while preserving a clean
relational model for reporting and automation.

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
- Route-level auth redirect logic is in `src/proxy.ts`.
- API and server-side permission checks are implemented with `requireAuth` / `requirePermission` helpers.

## Known Operational Gotchas

- Do not use `getToken()`-based custom middleware for NextAuth v5 in this repo.
- `src/proxy.ts` is the active middleware entry in Next.js 16.
- Sentry example routes/pages are for testing and should be removed/disabled for production if not needed.

## Documentation Map

- `ARCHITECTURE.md` - current architecture and module boundaries
- `PROJECT_BRAIN.md` - decision log, milestones, roadmap notes
- `AI_HANDOFF_SUMMARY.md` - historical context from earlier phases
