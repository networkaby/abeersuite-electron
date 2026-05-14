<!-- BEGIN:nextjs-agent-rules -->

# Agent rules

This repo uses a customized Next.js setup with strict conventions. Read this file in full before making any change.

## 1. Core principles

- **This is NOT the Next.js you know.** APIs, conventions, and file structure may differ from training data. Before writing code, read the relevant guide in `node_modules/next/dist/docs/` and respect any deprecation notices.
- **Explain before you code.** For every change, first explain in simple English what you understand and what you plan to do, then confirm before editing.
- **Stack defaults:** use **shadcn/ui** for UI and **Zustand** for state. Do not introduce alternatives without explicit approval.
- **Escape special characters.** Always use the escape character (`\`) for special characters in strings, regex, SQL, and shell commands when needed.

## 2. DRY — don't repeat yourself

Before creating a **new** helper, hook, schema, formatter, or shared UI component, look for something to reuse:

- [docs/reusables.md](docs/reusables.md)
- `src/shared/`
- The relevant `docs/modules/<module>.md` → **Reusable helpers — DO NOT duplicate** table

Prefer extending or importing an existing symbol over copying logic. If nothing fits and you add new reusable surface area, implement it in the appropriate shared location and register it in the reusables docs in the same change (see [§6 Completion checklist](#6-completion-checklist--update-all-three-in-the-same-commit)).

## 3. Module-specific maps

For module-specific URLs, permissions, models, and wiring, read `docs/modules/<module>.md` first.

Each module doc follows the same template: URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Gotchas. This cuts the "what does this module touch?" question from N file globs to one file read.

Index: [docs/modules/README.md](docs/modules/README.md).

## 4. Completed & protected surfaces (no-regression rule)

Before editing critical completed flows, read `docs/completed-and-protected.md`.

- Treat listed items (POS, Balance Sheet, Profit & Loss, Day Book, etc.) as **preserve-first**.
- Refactors and styling are fine, but behavior or output changes require explicit user approval.
- Do not alter accounting math paths (`effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`) unless the task explicitly asks for accounting logic changes.
- If a protected surface is intentionally changed, update `docs/completed-and-protected.md` in the same commit.

## 5. Seeds — keep production & dummy in sync with the schema

All seed scripts live in `prisma/seeds/`. Read [docs/seeds.md](docs/seeds.md) before changing any of them.

- **Production seed:** `prisma/seeds/bootstrap-seed.ts`, run via `pnpm prisma db seed` (wired in `prisma.config.ts`). Single source of truth for RBAC, pipelines, statuses, branches, departments, chart of accounts, and DB constraints.
- **Dummy seeds:** `prisma/seeds/dummy-*.ts`, run manually via `pnpm seed:dummy-*`. These are the canonical demo for the current schema.
- **Cleaner:** `prisma/seeds/hard-clean.ts` (`pnpm seed:hard-clean`) — wipes everything bootstrap doesn't seed, returning the DB to bootstrap state.
- **Fixture data** (hardcoded product lists, demo content) lives in `prisma/seeds/data/`, never in `src/`.

**Hard rule:** any commit that changes `prisma/schema/*.prisma` must also update `bootstrap-seed.ts` and the affected `dummy-*.ts` in the same commit.

- If a column is added, the seeds must populate it.
- If a model is renamed, the seeds must rename too.
- Dummy scripts must stay runnable — agents and humans rely on `pnpm seed:dummy-all` to produce a working demo. Drift here is a regression.

When `hard-clean.ts` needs to remove rows from a new dummy-only table, extend its `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` arrays in the same commit that introduces the table.

## 6. Completion checklist — update all three in the same commit

Before declaring a plan or segment done, update **all three** of the following in the same commit. Skipping any of them creates drift that future contributors won't catch.

1. **Docs** — every doc the change touched. At minimum:
   - The relevant `docs/modules/<module>.md` (URLs, permissions, components, workflows, gotchas).
   - `docs/seeds.md` if seed scripts, fixture data, or `hard-clean.ts` changed.
   - `docs/plans/<NN>-<segment>.md` if the executed plan diverged from what was written there — record what actually happened.
   - Any other `docs/<file>.md` referenced by the change.
2. **Todo list** — mark every task `completed` as you finish it (not batched at the end). Remove dropped tasks, add follow-ups discovered during execution. The list should match what was actually done before the commit lands.
3. **Reusables registry** — if the change added or removed a helper, hook, schema, formatter, or shared component, register or unregister it in:
   - `docs/reusables.md` (cross-cutting items in `src/shared/`).
   - The relevant `docs/modules/<m>.md` → **Reusable helpers — DO NOT duplicate** table (module-scoped items).
   - If the symbol is renamed or moved, update both the old entry and the new one — leave no dangling reference.

If the change is a structural move (renames, file relocations) but adds no new symbols, only docs + todo updates are needed; the reusables registry is unchanged.

<!-- END:nextjs-agent-rules -->
