<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Before Any Change You must explain
use shadcn, zustand

# DRY — don't repeat yourself

Before creating a **new** file for a helper, hook, schema, formatter, or shared UI, look for something similar to reuse: [docs/reusables.md](docs/reusables.md), `src/shared/`, and the relevant `docs/modules/<module>.md` **Reusable helpers — DO NOT duplicate** table. Prefer extending or importing an existing symbol over copying logic. If nothing fits and you add new reusable surface area, implement it in the appropriate shared location and register it in the reusables docs in the same change (see **Reusables registry** under *After every plan / segment completes*).

# Module-specific maps

For module-specific URLs, permissions, models, and wiring, read `docs/modules/<module>.md` first. Each doc follows the same template — URLs (UI + API), Permissions, Prisma models, Key components, Common workflows, Gotchas. Cuts the "what does this module touch" question from N file globs to one file read. Index: [docs/modules/README.md](docs/modules/README.md).

# Completed + protected surfaces (no-regression rule)

Before editing critical completed flows, read `docs/completed-and-protected.md`.

- Treat listed items (POS, Balance Sheet, Profit & Loss, Day Book, etc.) as **preserve-first**.
- Refactors/styling are fine, but behavior/output changes require explicit user approval.
- Do not alter accounting math paths (`effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`) unless the task explicitly asks for accounting logic changes.
- If a protected surface is intentionally changed, update `docs/completed-and-protected.md` in the same commit.

# Seeds — keep production + dummy in sync with the schema

All seed scripts live in `prisma/seeds/`. Read [docs/seeds.md](docs/seeds.md) before changing any of them.

- **Production seed** is `prisma/seeds/bootstrap-seed.ts`, run via `pnpm prisma db seed` (wired in `prisma.config.ts`). Single source of truth for RBAC, pipelines, statuses, branches, departments, chart of accounts, DB constraints.
- **Dummy seeds** are `prisma/seeds/dummy-*.ts`, run manually via `pnpm seed:dummy-*`. They are the canonical demo for the current schema.
- **Cleaner** is `prisma/seeds/hard-clean.ts` (`pnpm seed:hard-clean`) — wipes everything bootstrap doesn't seed, returning the DB to bootstrap state.
- **Fixture data** (hardcoded product lists, demo content) lives in `prisma/seeds/data/`, never in `src/`.

**Hard rule:** any commit that changes `prisma/schema/*.prisma` must also update `bootstrap-seed.ts` and the affected `dummy-*.ts` in the same commit. If a column is added, the seeds populate it. If a model is renamed, the seeds rename. The dummy scripts must stay runnable — agents and humans rely on `pnpm seed:dummy-all` to produce a working demo. Drift here is a regression.

When `hard-clean.ts` needs to remove rows from a new dummy-only table, extend its `TRANSACTION_TABLES` / `INVENTORY_MASTERS` / `DUMMY_CONFIG_TABLES` arrays in the same commit that introduces the table.

# After every plan / segment completes — update three things in the same commit

Before declaring a plan or segment done, update **all three** of the following in the same commit. Skipping any of them creates drift that future contributors won't catch.

1. **Docs** — every doc the change touched. At minimum:
   - The relevant `docs/modules/<module>.md` (URLs, permissions, components, workflows, gotchas).
   - `docs/seeds.md` if seed scripts, fixture data, or `hard-clean.ts` changed.
   - `docs/plans/<NN>-<segment>.md` if the executed plan diverged from what was written there — record what actually happened.
   - Any other `docs/<file>.md` referenced by the change.
2. **Todo list** — mark every task `completed` (not batched at the end; mark as you finish each one). Remove tasks that were dropped, add follow-ups discovered during execution. The list should match what was actually done before the commit lands.
3. **Reusables registry** — if the change added or removed a helper / hook / schema / formatter / shared component, register or unregister it in:
   - `docs/reusables.md` (cross-cutting items in `src/shared/`).
   - The relevant `docs/modules/<m>.md` "Reusable helpers — DO NOT duplicate" table (module-scoped items).
   - If the symbol is renamed or moved, update both the old entry and the new one — leave no dangling reference.

If the change is a structural move (renames, file relocations) but adds no new symbols, only docs + todo updates are needed; the reusables registry is unchanged.

<!-- END:nextjs-agent-rules -->
