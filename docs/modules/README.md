# Module Maintenance Docs

Read the module doc relevant to the work you're doing **before** grepping. Each file follows the same template, so an agent or human landing in any module knows exactly where to look.

## Template

```markdown
# <Module Name>

> One-paragraph summary of what this module does and who uses it.

## URLs
### UI pages
- `/office/<module>/...` → file path

### API routes
- `GET /api/<module>/...` → file path + brief purpose

## Permissions (gate keys)
- `<area>:<op>:<scope>` — what it controls

## Prisma models
- `<Model>` (file: `prisma/schema/<file>.prisma`) — short purpose, key relations

## Key components
- `<Component>` (file: `src/modules/<module>/...`) — what it renders / when used

## Library / helpers
- `<helper>` (file: `src/modules/<module>/lib/<helper>.ts` for module-scoped, or `src/shared/lib/<bucket>/<helper>.ts` for cross-cutting) — short purpose

## Common workflows (wiring)
1. <e.g. "Creating an invoice from a ticket"> — clickable trail of files involved.

## Recent decisions / gotchas
- One-liners pointing to dated decisions in memory.

## Out of scope / deferred
- Things the module doesn't own.

_Last updated: <YYYY-MM-DD> — covers state after <change>._
```

## Conventions

- One short paragraph per section, not exhaustive — this is a map, not a manual. Omit empty sections.
- Cross-link, don't duplicate. Link to source files and to other module docs when concerns cross.
- Date the doc footer so readers know when it might be stale.

## Seed system

**One bootstrap, many dummies.**

| Command | When to run | What it does |
|---|---|---|
| `pnpm prisma db seed` | **Production day-1, ONLY.** Auto-runs after `pnpm prisma migrate reset`. | All settings + RBAC + chart of accounts + admin user. Idempotent. |
| `pnpm seed:dummy-all` | Dev / demo only | Test customers, products, users, vouchers |
| `pnpm seed:hard-clean` | Reset to bootstrap state | Wipes everything bootstrap didn't seed |
| `pnpm seed:purge-vouchers` | Quick books reset | Wipes vouchers/JEs only; preserves customers + products |

**Files** (all in `prisma/seeds/`):

- `bootstrap-seed.ts` — **the only production seed**. Wired in `prisma.config.ts → migrations.seed`. Roles, permissions, pipelines, statuses, branches, departments, chart of accounts, admin user (`admin@networkservice.in / admin123`), DB constraints.
- `dummy-users.ts` — 3 demo non-admin users (tech / front / des)
- `dummy-shop.ts` — demo product catalog + InvUnit "PCS"
- `dummy-customers.ts` — sample Persons + Companies + Phones + Emails
- `dummy-vouchers.ts` — stub for sample vouchers (placeholder)
- `hard-clean.ts` — destructive reset to bootstrap state
- `purge-vouchers.ts` — narrower wipe (vouchers/JEs only)

Fresh-start drill: `pnpm prisma db push --force-reset && pnpm prisma db seed`.

### ⚠️ Maintenance rule

When you change `prisma/schema/*.prisma` (add / rename / drop a column or table), **update `bootstrap-seed.ts` to match in the same commit**. The dummy-*.ts files describe demo data; only `bootstrap-seed.ts` describes the production-required state. If a schema change breaks bootstrap, dev environments lose the ability to do a clean reset.

---

## Reusable helpers — start here before writing new code ⚠️

Each module doc has a **"Reusable helpers — DO NOT duplicate"** table listing the central helpers for balance, valuation, posting, and aggregation math. Search those tables (Ctrl-F "DO NOT duplicate") before writing inline arithmetic — every report must agree, and the only way to keep them in sync is one helper for one calculation. Live registries:

- [accountancy.md → Reusable helpers](./accountancy.md#reusable-helpers--do-not-duplicate-) — `balanceDelta`, `effectiveLedgerBalance`, `loadGroupRolledUpBalances`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`, `computeTradingStockAdjustment`, `getClosingStockValue`, `isStockEligibleAccount`, `voucherLifecycle`…
- [inventory.md → Reusable helpers](./inventory.md#reusable-helpers--do-not-duplicate-) — `productOpeningValue`, `syncProductCacheFromOpening`, `productClosingValue`, `invNextRef`, `calcLineTotals`, `calcVoucherTotals`…

## Module list

- [accountancy.md](./accountancy.md) — Tally/finance suite (renamed 2026-05-07)
- [repair.md](./repair.md) — Tickets, devices, service centres, warranty
- [inventory.md](./inventory.md) — Products, GRN, POs, units, categories
- [sales.md](./sales.md) — Store, online (ecommerce), wholesale, coupons, shop orders
- [people.md](./people.md) — Person (was Customer) / Company / shared Phone & Email tables / Account (GL ledger), CRM leads
- [admin.md](./admin.md) — Roles, users, branches, departments, posts, pipelines, statuses
- [messaging.md](./messaging.md) — Internal chat, notifications, social wall
- [customer-portal.md](./customer-portal.md) — External `/shop` + customer self-service
