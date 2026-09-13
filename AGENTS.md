# Agent Rules

## 1. Before Coding

- **Repeat the request back point-to-point**, explain understanding + plan, then **wait for approval before editing**.
- Explain in non-tech words. Simple Indian English, project vocabulary.
- `/lab` holds incomplete modules under construction.
- Anything coming from Supabase/DB must be cached to save reading cost.

**Workflow:** Understand → Repeat back → Explain plan → Wait for approval → Edit → Check impact → Update seeds/docs → Validate.

## 2. Product

Every printable document must be customizable through the print template.

## 3. Current Phase: Refactor & Simplify

Project is nearly complete. Prefer **simple, maintainable, DRY code**; remove duplicate logic and abstractions. Before deleting or changing a table, field or relation, check **seeds, APIs and UI**.

### Database — `CURRENT_DB=demo`

- **demo** = local PostgreSQL demo data, reset allowed. **live** = production data, **never full-reset**.
- Schema changes must include migrations committed to `origin/dev` or `main`, and deployment must apply them without causing problems. How: `docs/migrations.md` (`pnpm db:migrate`; every pre-2026-09-13 database needs `pnpm db:migrate:baseline` once).

## 4. Reuse First

Before creating shared code: check `src/shared/` → extend existing if possible → otherwise add it there and export from `index.ts`.

## 5. Seeds

Read `docs/seeds.md` first — it owns the scripts and the dev loop. The rules that live here:

- Every schema / permission / master-data / config change updates **generic catalog, personal snapshot and the DB in the same commit**. Permissions: add to `lib/codeOwnedCatalog.ts` + `src/shared/lib/constants/permissions.ts`, then `pnpm prisma db seed`. (There is no `apply-permissions` script any more — the catalog IS the source of truth and both seeds apply it in full.)
- A full `pnpm prisma db seed` also runs the **R1 top-up**: it grants R1 every non-`systemOnly` permission in the catalog. If a permission has been deliberately taken away from R1 in the Role Matrix, a reseed puts it back.
- Small change → **targeted idempotent script, never a full seed**. Full `pnpm prisma db seed` for reset, drift recovery, full config reassertion — and now for shipping a permission.
- Ownership: code → `codeOwnedCatalog.ts`; our real setup → `bootstrap-seed.ts`; brands → `helper-brands.ts`; everything else configured (categories, product groups, chart of accounts, POS, RBAC grants) → `personal.local.json`. **Never capture passwords.**
- DB inconsistent: **fix seeds → reset → reseed**.

## 6. Documentation

`PROJECT_BRAIN.md` is the only status doc. After routes/APIs/Prisma/major components/important behavior changes: update docs in the same commit and run `/sync-docs-with-code`. Narrative-only changes: update directly.

Commands: `pnpm seed:check-docs` · `pnpm seed:fix-docs` · `pnpm precommit` · `pnpm install:git-hooks`

## 7. Cost & Performance

Priority: **UX → DB → Server**.

- **UX:** optimistic updates with rollback, prefetch, no blank flicker, show cached data while refreshing.
- **DB:** DB pagination, select needed columns only, avoid `SELECT *` and query-per-item.
- **Server:** browser cache, batch mutations, defer non-critical work, ISR for store pages, short TTL for office.

## 8. Branches

- Worktree work **starts from `main`** (`git merge --ff-only main` before editing) and **merges back into `main`**. If the checkout is currently on `dev`, merge it into `dev` as well — `dev` is not a substitute for `main`.
- **Releases go out from `main` only** — never `dev`, `d_office`, or a detached HEAD; the tag points at `HEAD`.
- **Never push.** Release is the one exception — §9 steps 5, 7 and 8 are pushes the owner asked for by saying "release". Everything else stops at the commit.

## 9. Release — the agent carries it out

When the owner says **"do a release"** (or release / publish / ship a version), that is **one instruction for this whole list**, not for one command. Do not stop after `pnpm electron:release` and hand the rest back. Runbook: `.claude/skills/release/SKILL.md`. Convention and full detail: `docs/commands.md` §0.

1. `git checkout main && git merge --ff-only dev` — not fast-forwardable → stop and report, never force.
2. Bump `version` in `package.json`.
3. **Write `RELEASE_NOTES.md` yourself** — customer-readable, rewritten from scratch, from the actual commits since the last tag. `[urgent]` in the first line only when every counter must restart today. Never leave last version's notes.
4. Commit the bump + notes on `main`.
5. `git push origin main && git push production main` — push before building.
6. `pnpm electron:release` — pack, `verify:package` gate, tag `v<version>`, push tag to `origin`, publish. **A `-` in the version makes it a test build**: `1.3.1-pre.1` goes to `GITHUB_UPDATE_REPO_2` only, marked a GitHub prerelease; a version with no `-` goes to every `GITHUB_UPDATE_REPO_N`. Counters update from repo 1, so a test build never reaches a till. The gate is automatic — never use `RELEASE_ONLY_REPO` to get it.
7. `git push production main --tags`.
8. `git checkout dev && git merge --ff-only main && git push origin dev`.
9. Report: both remotes level, and installer + blockmap + `latest.yml` + notes present on every release repo.

**Ask the owner to join hand** at any step needing their eyes or their machine, rather than guessing or skipping it — the notes and their urgency tier, the smoke test (you cannot run the packaged exe), the `.env` variant (`APP_MODE`, `LANDING_PAGE`), a push they would rather run, and anything else that would be a guess. Say plainly what you need and wait. Handing a step back is not stopping the release: do everything either side of it, and pick the list up where you left off.

**Stop and ask** on a non-fast-forward merge, a failing `verify:package`, or a publish failure (then `RELEASE_ONLY_REPO=<repo>` to retry that one repo — never as the normal path).
