# Agent Rules

## 1. Before Coding

- Read this file completely.
- Use the project vocabulary and simple Indian English in all communication.
- all printable document should be customizable in print template
- Before making changes:
  1. Explain your understanding.
  2. Create a plan.
  3. Wait for approval before editing.

---

## 2. Current Phase: Refactoring & Simplification

The project is almost complete. Now we are focusing on:

- Refactoring code to make it simple and maintainable.
- Applying DRY (Don't Repeat Yourself) as much as possible.
- Removing unnecessary complexity.
- Dropping unused or redundant tables if required.

Important:

- Production DB in use

Guidelines:

- Prefer simplification over adding new abstractions.
- Remove duplicate logic instead of copying.
- If a table, field, or relation is not useful, propose removal.
- Always check impact on seeds, APIs, and UI before removing anything.
- Keep code easy to understand for future developers.

### Evolving concepts

Some domain ideas are still changing during refactoring. **Do not mix old and new concepts** in the same change — one model per flow, one vocabulary per surface.

When old and new conflict:

1. **Ask for confirmation** before picking a direction, or
2. **Park the conflict** — note it clearly and resolve in a follow-up; use a **temporary bridge** only when something must keep working across both models until migration is done.

Bridges must be obvious (comment, `TODO`, or `PROJECT_BRAIN.md` note) and removed once the new concept wins.

reduce permission gate. be flexible to allow. respect role page permissions no additional restriction needed.

---

## 3. Reuse Before Creating

Before adding a shared helper, hook, component, formatter, schema, or utility:

1. Search `src/shared/`.
2. Extend an existing implementation if possible.
3. Otherwise:

- Place it in the appropriate shared folder.
- Export it from that folder's `index.ts`.

Accepted legacy locations (leave in place; do not migrate imports):

- `src/utils/` — old constants/helpers that pre-date `src/shared`.
- `src/store/` — Zustand stores.
- `src/components/ui/` — shadcn-generated primitives.

Module-specific code belongs in:

```text
src/modules/<module>/
  components/
  hooks/
  lib/
```

Naming:

- Components → `PascalCase.tsx`
- Hooks → `useSomething.ts`
- Utilities, schemas, constants → `camelCase.ts`
- Directories → `kebab-case`

---

## 4. Seeds

Read `docs/seeds.md` before modifying seeds.

Two bootstraps, different jobs:

- `personal-bootstrap.ts` — **what `pnpm prisma db seed` runs.** Self-complete restore of OUR configuration: code-owned catalog (`lib/codeOwnedCatalog.ts`) + the captured snapshot (`data/personal.local.json`). Upsert-only, non-destructive — safe on the live DB.
- `bootstrap-seed.ts` — the generic NEW-CLIENT installer (`pnpm seed:generic`). Creates the generic demo world. **Never run it during normal development** — it resets config to generic.
- `hard-clean.ts` removes only dummy/helper data. Never delete bootstrap data.

The dev loop is **capture → edit → seed**:

1. Configure in the UI (or edit `personal.local.json` directly).
2. `pnpm seed:personal:capture` — snapshot the live config.
3. `pnpm prisma db seed` — re-apply it any time.

**THE RULE — on EVERY change to schema, permissions, master data, or config, the agent does all three, in the same commit:**

> **Why:** the two bootstraps are CLIENT tools — a client runs `pnpm seed:generic` once at install and `pnpm prisma db seed` (personal) at go-live/reset. The developer's own DB never needs a full seed to land one change; a full seed costs the developer (slow, hundreds of remote upserts). So: keep both bootstraps correct for clients, and apply the developer's own DB delta with a **temporary tsx script**.

1. **Update generic bootstrap** — `lib/codeOwnedCatalog.ts` for permission **definitions** (single source; both bootstraps import it) and `bootstrap-seed.ts` if generic demo content is affected.
2. **Update personal bootstrap** — `data/personal.local.json` for permission **grants** and our real config (R1 is auto-topped-up with new catalog permissions by the personal seed, so catalog-only additions need no manual grant edit); `lib/personalSnapshot.ts` if a NEW config table was added (export + import).
3. **Apply to the DB with a targeted script — never a full seed.** Full `pnpm prisma db seed` costs the DB (hundreds of remote upserts) and is NOT how a single change lands. Instead:
   - Permissions → `pnpm seed:apply-permissions` (edit its `ADDITIONS` list first).
   - Anything else → write a small one-off tsx script on the same pattern (connect like `apply-permissions.ts`, upsert just the changed rows, idempotent), run it, then delete or keep it as the next scratchpad.

Also update affected `dummy-*.ts` and `hard-clean.ts` (if needed).

Full `pnpm prisma db seed` (personal restore) is reserved for: a hard reset, recovering a drifted DB, or explicitly re-asserting the whole config — not for landing individual changes.

Always keep these working:

```bash
pnpm prisma db seed
pnpm seed:generic
pnpm seed:dummy-all
```

Master data:

- Code-owned (permissions, voucher series, DB CHECK constraints) → `lib/codeOwnedCatalog.ts`
- Universal demo defaults → `bootstrap-seed.ts`
- Trade-specific → `helper-inventory-masters.ts`
- Our real config → `data/personal.local.json` (git-tracked; passwords are never captured)

If the dev database becomes inconsistent, fix the seeds first, then reset and reseed (`pnpm prisma db seed`).

---

## 5. Documentation

- `PROJECT_BRAIN.md` is the only status document.
- All other docs describe the current implementation.

After changing routes, APIs, Prisma models, major components, or important behavior:

- Sync the documentation.
- Update docs in the same commit.

Useful commands:

```bash
pnpm seed:check-docs
pnpm seed:fix-docs
pnpm precommit
pnpm install:git-hooks
```

### When to invoke the skill

After making code changes that affect routes, APIs, Prisma models, key components, or gotchas in a module, invoke `/sync-docs-with-code`. The skill reads recent commits, drafts the prose updates for the affected module doc(s), bumps the `_Last updated:` footer, and re-runs the checker.

If you're committing pure narrative changes (a renamed concept in docs, a typo fix) the discipline collapses to: edit the doc in the same commit as the code. `_Last updated:` reflects that commit.
