<!-- BEGIN:nextjs-agent-rules -->

# Agent rules

Read this file in full before making any change to this repo.

## 1. Core principles

- **This is NOT the Next.js you know.** APIs, conventions, and file structure differ from training data. Before writing code, read the relevant guide in `node_modules/next/dist/docs/` and respect deprecation notices.
- **Explain before you code.** For every change, first explain in simple English what you understand and what you plan to do, then confirm before editing.
- **Stack defaults:** **shadcn/ui** for UI; **Zustand** for state. Don't introduce alternatives without explicit approval.
- **Numeric input rule:** do not use `input type="number"`. Use text inputs and validate/sanitize at the UI level.
- **Escape special characters** in strings, regex, SQL, and shell commands when needed.

## 2. Don't duplicate shared helpers

Before adding a shared helper, hook, schema, formatter, or component, grep `src/shared/` for the keyword.

- If extending an existing one — do it there.
- If adding a new one — put it in the matching sub-folder (`src/shared/lib/format/`, `src/shared/lib/api/`, `src/shared/hooks/`, etc.) and add it to that folder's `index.ts` barrel.

Single-module code lives in `src/modules/<m>/{lib,hooks,components}/`. Promote later, don't speculate.

**Naming:** components `PascalCase.tsx`; hooks `useFooBar.ts`; utilities / schemas / constants `camelCase.ts`; directories `kebab-case`.

## 3. Module-specific maps

For module-specific URLs, permissions, models, and wiring, read `docs/modules/<module>.md` first.

Each module doc follows the same template: URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Gotchas. Module docs are **reference only** — they don't carry "shipped" / "pending" status.

## 4. Completed & protected surfaces (no-regression rule)

Before editing critical completed flows, read `docs/completed-and-protected.md`.

- Treat listed items (POS, Balance Sheet, Profit & Loss, Day Book, etc.) as **preserve-first**.
- Refactors and styling are fine, but behaviour or output changes require explicit user approval.
- Don't alter accounting math paths (`effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`) unless the task explicitly asks for accounting logic changes.
- If a protected surface is intentionally changed, update `docs/completed-and-protected.md` in the same commit.

## 5. Seeds — keep production & dummy in sync with the schema

All seed scripts live in `prisma/seeds/`. Read [docs/seeds.md](docs/seeds.md) before changing any of them.

- **Database is disposable.** No important data lives in the dev database — reset it anytime (`pnpm prisma db push --force-reset`, migrate reset, or a fresh DB) when schema drift or bad data blocks progress.
- **Before resetting:** update `prisma/seeds/bootstrap-seed.ts` so it matches the current schema and seeds everything bootstrap needs. Fix seeds first, then reset and run `pnpm prisma db seed` (optional `pnpm seed:dummy-*` after).
- **Production seed:** `prisma/seeds/bootstrap-seed.ts`, run via `pnpm prisma db seed`. Single source of truth for RBAC, pipelines, statuses, branches, departments, chart of accounts, DB constraints.
- **Dummy seeds:** `prisma/seeds/dummy-*.ts`, run manually via `pnpm seed:dummy-*`. Canonical demo for the current schema.
- **Cleaner:** `prisma/seeds/hard-clean.ts` (`pnpm seed:hard-clean`) — wipes everything bootstrap doesn't seed.
- **Fixture data** (hardcoded product lists, demo content) lives in `prisma/seeds/data/`, never in `src/`.

**Hard rule:** any commit that changes `prisma/schema/*.prisma` must also update `bootstrap-seed.ts` and any affected `dummy-*.ts` in the same commit. If a column is added, seeds must populate it. If a model is renamed, seeds must rename too. `pnpm seed:dummy-all` must stay runnable.

When `hard-clean.ts` needs to remove rows from a new dummy-only table, extend its `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` arrays in the same commit.

## 6. Status lives in one place

`PROJECT_BRAIN.md` is the only doc that carries status (what's in flight, what shipped recently, what's next). Module docs and `ARCHITECTURE.md` are present-tense reference — they don't carry "shipped" / "pending" markers, milestone dates, or roadmap items. When something ships, update `PROJECT_BRAIN.md` only.

## 7. Doc-sync workflow

Docs drift in two ways. Tools handle one; you handle the other.

| Layer | Detected by | Fixed by |
|---|---|---|
| **Mechanical** — broken file paths in docs; permission keys in `bootstrap-seed.ts` that aren't in `permissions.ts` | `pnpm seed:check-docs` | `pnpm seed:fix-docs` (auto-applies safe fixes) |
| **Narrative** — module docs older than the code they document; missing new routes / APIs / gotchas in prose | `pnpm seed:check-docs` (reports "N days behind") | Claude, via the `sync-docs-with-code` skill in `.claude/skills/` |

### Commands

- `pnpm seed:check-docs` — detect drift, exit 0. Auto-chained after `pnpm seed:dummy-all`.
- `pnpm seed:fix-docs` — apply mechanical fixes (filters historical "X was removed" refs; adds missing permission constants).
- `pnpm precommit` — `--strict` mode: fails on mechanical drift only, narrative drift is informational.
- `pnpm install:git-hooks` — installs a pre-commit hook that runs `pnpm precommit` on every `git commit`.

### When to invoke the skill

After making code changes that affect routes, APIs, Prisma models, key components, or gotchas in a module, invoke `/sync-docs-with-code`. The skill reads recent commits, drafts the prose updates for the affected module doc(s), bumps the `_Last updated:` footer, and re-runs the checker.

If you're committing pure narrative changes (a renamed concept in docs, a typo fix) the discipline collapses to: edit the doc in the same commit as the code. `_Last updated:` reflects that commit.

<!-- END:nextjs-agent-rules -->
