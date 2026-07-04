<!-- BEGIN:nextjs-agent-rules --># Agent Rules

## 1. Before Coding

- Read this file completely.
<!-- - Read `docs/vocabulary.md`. -->
- Use the project vocabulary and simple Indian English in all communication.
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

- The database is currently empty, so there is **no data loss risk**.
- You can safely propose schema cleanup, table removal, or restructuring.

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

- `bootstrap-seed.ts` is the source of truth for production master data.
- `hard-clean.ts` removes only dummy/helper data. Never delete bootstrap data.

If `prisma/schema/*.prisma` changes, update in the same commit:

- `bootstrap-seed.ts`
- Affected `dummy-*.ts`
- `hard-clean.ts` (if needed)

Always keep these working:

```bash
pnpm prisma db seed
pnpm seed:dummy-all
```

Master data:

- Universal → `bootstrap-seed.ts`
- Trade-specific → `helper-inventory-masters.ts`

If the dev database becomes inconsistent, fix the seeds first, then reset and reseed.

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

<!-- END:nextjs-agent-rules -->
