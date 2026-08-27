# E2E tests (Playwright)

End-to-end browser tests that drive the running Next.js app at
`http://localhost:3000`.

## One-time setup

```bash
pnpm install                         # pulls @playwright/test
pnpm exec playwright install chromium
```

## Run

```bash
pnpm test:e2e          # headless, all projects
pnpm test:e2e:ui       # Playwright UI mode (watch / pick tests)
pnpm test:e2e:report   # open the last HTML report
```

`playwright.config.ts` auto-starts `pnpm dev` if nothing is listening on
:3000, and **reuses** an existing dev server locally — so you can keep your own
`pnpm dev` open and tests attach to it.

> Tests run against the **shared remote Supabase DB** (one worker, no
> parallelism). They are read-mostly; the mutating flows are `test.fixme` until
> verified. Run `pnpm seed:dummy-all` first if a report/register looks empty.

### Slow first run (expected on this machine)

Turbopack **cold-compiles** each office route on first hit, which is slow on
this disk (the office layout alone took ~50s; the heaviest routes 1–3 min). A
dedicated **`warmup` project** (`e2e/warmup.ts`) compiles every heavy authed
route once before the assertion specs run, so the real specs hit warm routes and
finish in seconds. The first full run takes ~15–30 min (mostly warmup);
subsequent runs reuse the `.next` cache and are fast.

### Troubleshooting

- **`page.goto` timeouts on office routes** → cold compile. The `warmup` project
  handles it; if you run a spec with `--no-deps` you skip warmup and may hit the
  raw compile time.
- **Turbopack panic on startup** (`thread '…' panicked at …aggregation_update.rs`)
  or **`ENOSPC: no space left on device`** → the `.next` cache got corrupted /
  the disk filled mid-compile. Fix: stop the dev server and
  `Remove-Item -Recurse -Force .next`, then re-run (it rebuilds clean). Clearing
  `.next` here reclaimed ~14 GB.

## Credentials

Read from env, with seeded-demo fallbacks (see `helpers.ts`):

| Var | Fallback | Used by |
|---|---|---|
| `E2E_STAFF_EMAIL` / `E2E_STAFF_PASSWORD` | `admin@networkservice.in` / `admin123` | auth setup + authed specs |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | from `.env` | login spec (DB-independent) |
| `E2E_CUSTOMER_IDENTIFIER` / `E2E_CUSTOMER_PASSWORD` | seeded portal customer | customer setup + customer specs |
| `E2E_BASE_URL` | `http://localhost:3000` | base URL |

`CUSTOMER` logs in via the customer login page's **Password** tab, not OTP —
OTP delivery needs a real SMS/email vendor, which isn't wired for tests (see
[[portal-passwordless-login]]).

## Layout

| File | Project | What it covers |
|---|---|---|
| `auth.setup.ts` | `setup` | Logs in as admin once → `e2e/.auth/admin.json` |
| `login.spec.ts` | `unauth` | Staff login page render, bad creds, super-admin login |
| `public.spec.ts` | `public` | Public storefront (`/`, `/shop`) render, no session |
| `customer-signin.spec.ts` | `customer-unauth` | Customer login page render, bad creds, password-login |
| `customer.setup.ts` | `customer-setup` | Logs in as the seeded customer once → `e2e/.auth/customer.json` |
| `warmup.ts` | `warmup` | Pre-compiles heavy authed routes (perf, not assertions) |
| `tests/reports.spec.ts` | `authed` | Balance Sheet · P&L · Trial Balance · Day Book load |
| `tests/pos.spec.ts` | `authed` | POS screen + shift controls (full sale = `fixme`) |
| `tests/voucher-lifecycle.spec.ts` | `authed` | Payments register + GL payment form (full cycle = `fixme`) |
| `tests-customer/portal.spec.ts` | `customer` | Portal home + tickets page load, signed in as customer |

Project order: `setup` → `warmup` → `authed` (Playwright runs dependencies
automatically; `--project=authed` pulls in both). Same pattern for the
customer side: `customer-setup` → `customer`. `public` and the two `*-unauth`
projects have no dependencies and no stored session.

## Known app quirks the tests work around

- **Post-login landing is overridden for speed.** The login page's built-in
  default `callbackUrl` is `/office/work-flow-inbox` (the Work Inbox /
  assignments dashboard). The tests pass an explicit `callbackUrl=/office` so
  the post-login render is lighter and deterministic.
- **GL payment route is `/vouchers/payments/new`** (plural, under the `(gl)`
  group), not `/vouchers/payment` as some docs say.
- **No `data-testid`s** anywhere — selectors are role/text/attribute based. The
  shadcn `<Label>`s on the login form aren't linked to their inputs (no
  `htmlFor`), so the tests target inputs by `type`.

## Finishing the `fixme` flows

`pos.spec.ts` and `voucher-lifecycle.spec.ts` each carry a `test.fixme` with the
exact steps for the deep mutation flow. There are **no `data-testid`s** in the
app, so those steps rely on role/text selectors — run `pnpm test:e2e:ui`, step
through against the live app, then remove the `.fixme`.
