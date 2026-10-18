# Agent Rules

## 1. Before Coding

- **Repeat the request back point-to-point**, explain understanding + plan, then **wait for approval before editing**.
- Explain in non-tech words. Simple Indian English, project vocabulary.
- Anything coming from Supabase/DB must be cached to save reading cost.

**Workflow:** Understand → Repeat back → Explain plan → Wait for approval → Edit → Check impact → Update seeds/docs → Validate.

**Always inspect and analyze code for bugs, temporary patches, code smells, technical debt, and any opportunities for improvement during all work—without asking for permission. Report every potential issue with its impact and recommended solution, even if unrelated to the current task, so the user can decide whether to fix, refactor, or defer it.**

## 2. Product

Every printable document must be customizable through the print template.

**Never** `<input type="number">`**.** The spinner steals the scroll wheel, paste
breaks, and the browser silently blanks a value it dislikes instead of telling
the user. Use `NumericInput` from `src/shared` (it binds a string and clamps on
blur). A box that must stay uncontrolled uses `type="text"` with `inputMode`,
sanitises each keystroke with `parseDigitsInput` / `parseDecimalInput`, and
clamps in code on blur — never with `min` / `max` / `step` attributes.

## 3. Current Phase: Refactor & Simplify

Project is nearly complete. Prefer **simple, maintainable, DRY code**; remove duplicate logic and abstractions. Before deleting or changing a table, field or relation, check **seeds, APIs and UI**.

### Database — `CURRENT_DB=live`

- **demo** = local PostgreSQL demo data, reset allowed. **live** = production data, **never full-reset**.
- Schema changes ship as **committed migrations**, and **Vercel applies them**: the `vercel-build` script runs `prisma migrate deploy` before the build, so a deploy brings the live DB's tables, columns and carried data with it. `pnpm db:migrate` by hand is now only for demo, counters and recovery. Vercel must have `DIRECT_URL` set — `prisma.config.ts` prefers it, and the pooled `DATABASE_URL` (port 6543, pgbouncer) cannot run migrations.
- **One migration per release, not one per change.** While a migration file has not been applied to _any_ database, keep folding further schema edits into that same file and re-run it locally. Start a new file only once it has been deployed, or when Postgres forces it — an enum `ADD VALUE` cannot be used in the transaction that adds it (see the `ADVANCE_FOR` pair).
- **An applied migration is frozen.** Its checksum is recorded in `_prisma_migrations`; editing it makes `migrate deploy` refuse to run at all. Never edit `0_init`. Every pre-2026-09-13 database needs `pnpm db:migrate:baseline` once.
- **Counter release goes out before the Vercel deploy** that carries the migration — the deploy being the `d_office` push, §9 step 9. The server getting ahead of a replica halts every table on that till (`schemaGuard.js`, exit 4), not just the changed one.
- How, in full: `docs/migrations.md`.

## 4. Reuse First

Before creating shared code: check `src/shared/` → extend existing if possible → otherwise add it there and export from `index.ts`.

## 5. Seeds

Read `docs/seeds.md` first — it owns the scripts and the dev loop. The rules that live here:

- Every schema / permission / master-data / config change updates **generic catalog, personal snapshot and the DB in the same commit**. Permissions: add to `src/shared/lib/auth/permissionCatalog.ts` + `src/shared/lib/constants/permissions.ts`, then `pnpm prisma db seed` (a `ui:sidebar:` link needs no seed — the Departments / Role save creates its row on first use). (There is no `apply-permissions` script any more — the catalog IS the source of truth and both seeds apply it in full.)
- A full `pnpm prisma db seed` also runs the **R1 top-up**: it grants R1 every non-`systemOnly` permission in the catalog. If a permission has been deliberately taken away from R1 in the Role Matrix, a reseed puts it back.
- Small change → **targeted idempotent script, never a full seed**. Full `pnpm prisma db seed` for reset, drift recovery, full config reassertion — and now for shipping a permission.
- Ownership: code → `permissionCatalog.ts` (+ `codeOwnedCatalog.ts` for constraints / series); our real setup → `bootstrap-seed.ts`; brands → `helper-brands.ts`; everything else configured (categories, product groups, chart of accounts, POS, RBAC grants) → `personal.local.json`. **Never capture passwords.**
- DB inconsistent: **fix seeds → reset → reseed**.

## 6. Documentation

`PROJECT_BRAIN.md` is the only status doc. After routes/APIs/Prisma/major components/important behavior changes: update docs in the same commit and run `/sync-docs-with-code`. Narrative-only changes: update directly.

Commands: `pnpm seed:check-docs` · `pnpm seed:fix-docs` · `pnpm precommit` · `pnpm install:git-hooks`

## 7. Cost & Performance

Priority: **UX → DB → Server**.

- **UX:** optimistic updates with rollback, prefetch, no blank flicker, show cached data while refreshing.
- **DB:** DB pagination, select needed columns only, avoid `SELECT` and query-per-item.
- **Server:** browser cache, batch mutations, defer non-critical work, ISR for store pages, short TTL for office.

## 8. Branches

- Worktree work **starts from** `main` (`git merge --ff-only main` before editing) and **merges back into** `main`. If the checkout is currently on `dev`, merge it into `dev` as well — `dev` is not a substitute for `main`.
- **Releases go out from** `main` **only** — never `dev`, `d_office`, or a detached HEAD; the tag points at `HEAD`.
- **Never push.** Release is the one exception — §9 steps 5, 7 and 8 are pushes the owner asked for by saying "release". Everything else stops at the commit.

## 9. Release — the agent carries it out

When the owner says **"do a release"** (or release / publish / ship a version), that is **one instruction for this whole list**, not for one command. Do not stop after `pnpm electron:release` and hand the rest back. Runbook: `.claude/skills/release/SKILL.md`. Convention and full detail: `docs/commands.md` §0.

1. `git checkout main && git merge --ff-only dev` — not fast-forwardable → stop and report, never force.
2. Bump `version` in `package.json`.
3. **Write** `RELEASE_NOTES.md` **yourself** — customer-readable, rewritten from scratch, from the actual commits since the last tag. `[urgent]` in the first line only when every counter must restart today. Never leave last version's notes.
4. Commit the bump + notes on `main`. Message it `chore(release): attempt v<version> - <one line>` — the build has not run yet, so the commit must not claim the version shipped. The tag from step 6 is the proof; never reword the commit afterwards.
5. `git push origin main && git push production main` — push before building.
6. `pnpm electron:release` — pack, `verify:package` gate, tag `v<version>`, push tag to `origin`, publish. **A** `-` **in the version makes it a test build**: `1.3.1-pre.1` goes to `GITHUB_UPDATE_REPO_2` only, marked a GitHub prerelease; a version with no `-` goes to every `GITHUB_UPDATE_REPO_N`. Counters update from repo 1, so a test build never reaches a till. The gate is automatic — never use `RELEASE_ONLY_REPO` to get it.
7. `git push production main --tags`.
8. `git checkout dev && git merge --ff-only main && git push origin dev`.
9. **If the release touches what Vercel serves** (`git diff --stat d_office..main` / `d_shop..main` shows web code, `prisma/`, `public/`, deps — not just `electron/`, packaging or docs), fast-forward **both** `d_office` and `d_shop` to `main` **without asking**: `git checkout d_office && git merge --ff-only main && git checkout d_shop && git merge --ff-only main && git checkout main`. **Never push them** — the owner pushes by hand. These are the Vercel deploy branches; pushing `main` or `dev` deploys nothing. On a schema release the counters take the build first (§3); `pnpm db:migrate:status` says whether the migration is pending.
10. Report: `main` and `dev` on the released commit, both remotes level, installer + blockmap + `latest.yml` + notes present on every release repo. **End with the Vercel reminder**: which of `d_office` / `d_shop` were fast-forwarded (or skipped and why), that they are not pushed so the sites still run old code, and the `git push origin d_office` / `git push origin d_shop` commands.

**Publish as soon as possible.** No smoke-test stop, no pause for the owner to test — if something needs checking, test it yourself and carry on. **Ask the owner to join hand** at any step needing their eyes or their machine, rather than guessing or skipping it — the notes and their urgency tier (ask once), the `.env` variant (`APP_MODE`, `LANDING_PAGE`), a push they would rather run, and anything else that would be a guess. Say plainly what you need and wait. Handing a step back is not stopping the release: do everything either side of it, and pick the list up where you left off.

`/release urgent` (or "release urgent") means nothing to ask: notes go out `[urgent]`, the `.env` variant is used as it is, no waiting — run the list straight through.

**Stop and ask** on a non-fast-forward merge, a failing `verify:package`, or a publish failure (then `RELEASE_ONLY_REPO=<repo>` to retry that one repo — never as the normal path).
