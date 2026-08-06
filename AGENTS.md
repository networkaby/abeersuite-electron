# Agent Rules

## 1. Before Coding

- Read this file completely.
- Use project vocabulary and simple Indian English.
- **Repeat back first:** when the user says something, restate it point-to-point in your own words before acting. The user's English may be unclear — confirm you understood correctly, so you don't start wrong edits on a misunderstanding.
- Then: explain your understanding, make a plan, wait for approval before editing.

---

## 2. Product Rules

- All printable documents must be customizable in the print template.

---

## 3. Current Phase: Refactoring & Simplification

Project almost complete. Focus:

- Refactor for simple, maintainable code. Apply DRY. Remove unnecessary complexity; drop unused/redundant tables if needed.
- Prefer simplification over new abstractions. Remove duplicate logic, don't copy.
- Before removing a table/field/relation, check impact on seeds, APIs, UI.

Databases:

- Two separate DBs: **demo db** and **live DB**.
- `CURRENT_DB = demo DB` → may reset freely. _(Change to_ `live` _on production data — then no full reset. Update when connected DB changes.) we are using [localhost](http://localhost) with local PGSQL demo data_

### Evolving concepts

- Don't mix old and new concepts in one change — one model per flow, one vocabulary per surface.
- Old→new transition almost done. Leftover old gates/rules may wrongly block the new concept. When found, flag and fix — don't build on top.
- On conflict: ask for confirmation, or park it (note clearly, resolve later). Use a **temporary bridge** only if something must work across both models until migration. Bridges must be obvious (comment, `TODO`, `PROJECT_BRAIN.md`) and removed once new concept wins.
- **RBAC bridge (temporary):** new RBAC controls at **page level** — role sees nav link, and Create/Edit/Delete inside page. Server-side hard-gate security is a **TODO**. Until then, relax old leftover hard gates; respect the page permission model, no extra restriction on top.

---

## 4. Reuse Before Creating

Before adding a shared helper/hook/component/formatter/schema/utility:

1. Search `src/shared/`.
2. Extend existing if possible.
3. Else place in the right shared folder, export from its `index.ts`.

Legacy locations (leave in place, don't migrate imports):

- `src/utils/` — old constants/helpers pre-dating `src/shared`.
- `src/store/` — Zustand stores.
- `src/components/ui/` — shadcn primitives.

Module code → `src/modules/<module>/{components,hooks,lib}/`

Naming: Components `PascalCase.tsx` · Hooks `useSomething.ts` · Utils/schemas/constants `camelCase.ts` · Directories `kebab-case`

---

## 5. Seeds

Read `docs/seeds.md` first.

- `personal-bootstrap.ts` — runs on `pnpm prisma db seed`. Restores OUR config: `lib/codeOwnedCatalog.ts` + snapshot `data/personal.local.json`. Upsert-only, safe on live DB.
- `bootstrap-seed.ts` — generic NEW-CLIENT installer (`pnpm seed:generic`). **Never run in normal dev** — resets config to generic.
- `hard-clean.ts` — removes only dummy/helper data. Never delete bootstrap data.

Dev loop = capture → edit → seed: configure in UI → `pnpm seed:personal:capture` → `pnpm prisma db seed`.

**THE RULE — on every change to schema/permissions/master data/config, do all three in the same commit:**

1. **Generic bootstrap** — `lib/codeOwnedCatalog.ts` for permission definitions (single source, both bootstraps import it); `bootstrap-seed.ts` if generic demo content changes.
2. **Personal bootstrap** — `data/personal.local.json` for grants and real config (R1 auto-tops-up new catalog permissions, so catalog-only additions need no grant edit); `lib/personalSnapshot.ts` if a NEW config table was added.
3. **Apply to DB with a targeted script — never a full seed** (full seed = hundreds of slow remote upserts):

- Permissions → `pnpm seed:apply-permissions` (edit its `ADDITIONS` list first).
- Else → small idempotent one-off tsx script (same pattern as `apply-permissions.ts`), run, then delete or reuse.

Also update affected `dummy-*.ts` and `hard-clean.ts` if needed.

Full `pnpm prisma db seed` only for: hard reset, recovering a drifted DB, or re-asserting whole config — not single changes.

Keep working: `pnpm prisma db seed` · `pnpm seed:generic` · `pnpm seed:dummy-all`

Master data location:

- Code-owned (permissions, voucher series, CHECK constraints) → `lib/codeOwnedCatalog.ts`
- Universal demo defaults → `bootstrap-seed.ts`
- Trade-specific → `helper-inventory-masters.ts`
- Our real config → `data/personal.local.json` (git-tracked; passwords never captured)

If dev DB inconsistent: fix seeds first, then reset and reseed.

---

## 6. Documentation

- `PROJECT_BRAIN.md` is the only status doc. Others describe current implementation.
- After changing routes, APIs, Prisma models, major components, or important behavior: sync docs in the same commit, then invoke `/sync-docs-with-code`.
- Pure narrative changes (renamed concept, typo): just edit the doc in the same commit.

Commands: `pnpm seed:check-docs` · `pnpm seed:fix-docs` · `pnpm precommit` · `pnpm install:git-hooks`
