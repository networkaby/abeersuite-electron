# Agent Rules

## 1. Before Coding

- Read `AGENT_RULES` fully before coding.
- Use project vocabulary and simple Indian English.
- First **repeat the user's request point-to-point** in your own words to confirm understanding.
- Explain understanding + plan.
- **Wait for approval before editing.**
- /lab in incomplete module under constraction
- anything coming from supabase/DB must be cached to save reading cost.

## 2. Product

- Every printable document must be customizable through the print template.

## 3. Current Phase: Refactor & Simplify

- Project is nearly complete.
- Prioritize **simple, maintainable, DRY code**.
- Remove duplicate/unnecessary logic and abstractions.
- Before deleting/changing a table, field, or relation, check **seeds, APIs, and UI**.

### DB Rules

---

- Two DBs: **demo** and **live**.
- `CURRENT_DB=demo` → local PostgreSQL demo data; reset allowed.
- `live` → production data; **never full-reset**.
- Schema changes must include migrations committed to `origin/dev` or `main`.
- Deployment must apply migrations without causing problems.
-

## 4. Reuse First

Before creating shared code: check `src/shared/` → extend existing if possible → otherwise add it there and export from `index.ts`.

## 5. Seeds

Read `docs/seeds.md` first.

- `personal-bootstrap.ts` / `pnpm prisma db seed` = our config, upsert-only, safe on live.
- `bootstrap-seed.ts` / `pnpm seed:generic` = generic new-client setup; never normal dev.
- `hard-clean.ts` = remove dummy/helper data only.

Dev: `UI configure → pnpm seed:personal:capture → pnpm prisma db seed`.

For every schema/permission/master-data/config change, same commit must update:

1. Generic: `lib/codeOwnedCatalog.ts`; `bootstrap-seed.ts` if needed.
2. Personal: `data/personal.local.json`; `lib/personalSnapshot.ts` for new config tables.
3. DB: targeted idempotent script, never full seed for a small change. Permissions: update `ADDITIONS` → `pnpm seed:apply-permissions`.

Update affected `dummy-*.ts` / `hard-clean.ts`. Full `pnpm prisma db seed` only for reset, drift recovery, or full config reassertion.

Ownership: code → `codeOwnedCatalog.ts`; universal demo → `bootstrap-seed.ts`; trade → `helper-inventory-masters.ts`; real config → `personal.local.json`. Never capture passwords.

DB inconsistent: **fix seeds → reset → reseed**.

## 6. Documentation

`PROJECT_BRAIN.md` is the only status doc. After routes/APIs/Prisma/major components/important behavior changes: update docs in same commit and run `/sync-docs-with-code`. Narrative-only changes: update directly.

Commands: `pnpm seed:check-docs` · `pnpm seed:fix-docs` · `pnpm precommit` · `pnpm install:git-hooks`

## 7. Cost & Performance

- **DB:** DB pagination, select needed columns only, avoid `SELECT` and query-per-item.
- **Server:** browser cache, batch mutations, defer non-critical work, ISR for store pages, short TTL for office.
- **UX:** optimistic updates with rollback, prefetch, no blank flicker, show cached data while refreshing.
- **Priority:** **UX → DB → Server**.

### Core workflow

**Understand → Repeat back → Explain plan → Wait for approval → Edit → Check impact → Update seeds/docs → Validate.**
