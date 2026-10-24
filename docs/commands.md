# Command Book — every `pnpm` script in this repo

One place that answers: *what does this command do, when do I run it, and can I skip it?*

- **Repo:** `abeersuite-electron` (Next.js app + Electron desktop counter + sync engine)
- **App version at time of writing:** `0.3.1`
- **Release target:** `devloperakramul/abeersuite-networkservice-update` (updater feed) and `devloperakramul/abeersuite-electron` (origin releases)
- **Package manager:** `pnpm` only

---

## 0. Release convention — what "do a release" means

**"Do a release" is never one thing done by hand. It is this whole list, every time, in this order. If any line is skipped, it was not a release.**

**A release only ever happens on `main`.** `dev` is where the work lands; `main` is what gets tagged, published and installed on counters. Never run `pnpm electron:release` from `dev`, from `d_office`, or from a detached HEAD — the tag the script creates points at `HEAD`, so releasing off `dev` mints a `v<version>` on a commit that `main` does not contain and the two source remotes stop agreeing about what that version is.

**You prepare (4 things — only these are yours):**

1. **Get on `main` with the release content:**

```bash
git checkout main && git merge --ff-only dev
```

   Not fast-forwardable means `main` carries something `dev` does not — resolve that first, never force it.

2. **Bump `version` in `package.json`.** This number *is* the tag, the GitHub release name, and what every counter's updater compares against. It goes up on every publish, no exception.
3. **Craft `RELEASE_NOTES.md` for this version.** Hand-written, customer-readable, rewritten — not appended to, not left from last time. The first line decides how counters take the update (see §9): `[urgent]` in the heading only when every counter must restart today.
4. **Commit the bump and the notes on `main`, and push `main` to both remotes before building:**

```bash
git push origin main && git push production main
```

   Push first, so the code is on both remotes even if the build then fails.

**`pnpm electron:release` then owns everything else — never do any of it by hand:**

5. `pnpm electron:pack` — full build + `electron-builder --dir` + `verify:package` gate
6. Release notes assembled = your `RELEASE_NOTES.md`, then the auto commit log since the previous version tag, in that order
7. Annotated git tag `v<version>` created if it does not already exist
8. `git push origin HEAD --tags` — `main` **and** the tag to `origin` (`devloperakramul/abeersuite-electron`)
9. A GitHub release published in **every** `GITHUB_UPDATE_REPO_N` from `.env` — or, when the version carries a `-` (`1.3.1-pre.1`), in `GITHUB_UPDATE_REPO_2` **only**, marked a GitHub prerelease — each with its own `GH_TOKEN_N` — one `electron-builder --publish always --prepackaged` run per repo, carrying installer, blockmap, `latest.yml` and the notes

**You finish (2 things, still manual today):**

10. **Push the tag to `production` too** — `scripts/release-electron.ts` pushes `origin` only, and both source remotes must carry the released commit and its tag (`origin` = `devloperakramul/abeersuite-electron`, `production` = `akramuljakir/abeersuite-electron`), otherwise the two accounts disagree about what `v<version>` is:

```bash
git push production main --tags
```

11. **Bring `dev` back level with `main`**, so the next day's work starts from the released tree:

```bash
git checkout dev && git merge --ff-only main && git push origin dev
```

12. **`d_office` and `d_shop` — fast-forward, never push.** Both are Vercel deploy
branches on `origin` (office site and shop site; `d_office` also runs `prisma migrate
deploy` through `vercel-build`). When the release touches what Vercel serves, fast-forward
both to `main` without asking; skip when only `electron/`, packaging or docs changed. The
owner pushes them by hand — the release report ends with that reminder and the commands.
On a schema release the counters take the build first (§9).

**Never, for any reason:**

- release from any branch other than `main`
- tag by hand, or push a tag on its own
- draft a release or upload a binary in the GitHub web UI
- publish to one release repo and leave the other behind — two exceptions, both deliberate: a **prerelease version** (any `-` in it) is *meant* to go to repo 2 alone and the script does that on its own, and the documented retry `RELEASE_ONLY_REPO=<repo> pnpm electron:release` is used *after* a partial failure, never as the normal path and never to force the prerelease split
- release without rewriting `RELEASE_NOTES.md`
- run `scripts/release-electron.ts` directly, bypassing the `verify:package` gate

**Done means:** `main` and `v<version>` are on **both** remotes, `dev` is level with `main`, and every release repo shows the installer, the blockmap, `latest.yml`, and the crafted notes.

---

## 1. Quick map — what to run daily

| Situation | Command |
| --- | --- |
| Work on the web app | `pnpm dev` |
| Work on the desktop app | `pnpm electron:dev` |
| Before every commit | `pnpm precommit` |
| Reset / reassert my own config | `pnpm prisma db seed` |
| Make an installer for testing | `pnpm electron:pack` |
| Publish a release to GitHub | `pnpm electron:release` |

Everything else in this document is occasional.

---

## 2. Full command list

### 2.1 Develop

| Command | What it does | Notes |
| --- | --- | --- |
| `pnpm dev` | `next dev` with a large HTTP header limit | Web app only, no Electron window |
| `pnpm electron:dev` | Runs Next dev **and** Electron together (`concurrently`), waits for `/staff/login`, compiles `electron/` TS, then launches Electron | The desktop daily driver |
| `pnpm electron:compile` | `tsc -p electron/tsconfig.json` only | Rarely run alone — `electron:dev` and `electron:build` both call it |
| `pnpm start` | `next start` on an existing `.next` build | Almost never used here |
| `pnpm lint` | `eslint` | |

### 2.2 Build and release

| Command | What it does |
| --- | --- |
| `pnpm build` | `strip-build` → `prisma generate` → `counter-build` (wraps `next build`) |
| `pnpm electron:build` | Loads `.env`, then runs the whole desktop build chain (see §3) |
| `pnpm electron:pack` | `electron:build` → `electron-builder --dir` → `verify:package` — unpacked folder, no installer |
| `pnpm electron:dist` | `electron:build` → `electron-builder` → `verify:package` — makes the real installer |
| `pnpm electron:release` | `electron:pack` → `release-electron.ts` — publishes the **already verified** tree to GitHub |
| `pnpm verify:package` | The build gate — checks the packaged tree for missing `node_modules`, symlinks into the pnpm store, stray `.env` files, and secrets outside the `counter.env` allowlist |
| `pnpm pg:fetch` | Downloads + trims the embedded PostgreSQL into `resources/pgsql` (~80 MB). **Once per build machine**, again on a version bump |
| `pnpm icon:build` | Regenerates the app icon |
| `pnpm build:downloader` | Compiles the small C# web-setup stub `AbeerSuite-WebSetup.exe`. It checks for the VC++ 2015-2022 x64 runtime (needed by the embedded PostgreSQL) and downloads it from Microsoft before launching the installer; `build/installer.nsh` repeats the check |
| `pnpm build:update-splash` | Compiles `resources/AbeerSuiteUpdateSplash.exe`, the window a counter shows while an update installs and the app is gone. Runs automatically as step 7 of `electron:build`; you rarely call it by hand. Shares its csc plumbing with the downloader via `scripts/lib/csc.ts` |

### 2.3 Guards and generators

| Command | What it checks / generates | In `precommit`? |
| --- | --- | --- |
| `pnpm seed:check-docs` | Docs match code | yes (`--strict`) |
| `pnpm seed:fix-docs` | Auto-fixes the mechanical part of the above | no |
| `pnpm check:nav-icons` | One lucide icon = one concept, app-wide | yes |
| `pnpm sync:tables` | Regenerates `prisma/sync-tables.json` (append-only table numbers) | — |
| `pnpm sync:tables:check` | Fails if that registry has drifted | yes |
| `pnpm db:local-schema` | Regenerates `resources/local-schema.sql` (the replica DDL) | — |
| `pnpm db:local-schema:check` | Fails if that DDL has drifted from `prisma/schema/` | yes |
| `pnpm check:counter-mode` | Counter/vercel routing guards and the v_live relay boundary, runs with **no database** | yes (5 variants) |
| `pnpm check:guard-lint` | Every exported API route handler is guarded (a staff guard, not a bare `auth()`) unless allowlisted | yes |
| `pnpm check:state-file` | The counter's userData files: a cut-short file reads as corrupt (never absent), the installation id is never re-minted on a counter, a locked file is retried | no |
| `pnpm precommit` | All seven of the above in one go | — |
| `pnpm install:git-hooks` | Installs the hook so `precommit` runs by itself | run once per clone |

### 2.4 Seeds

Read `docs/seeds.md` first. Current DB is **demo**.

| Command | What it does | Safe on live? |
| --- | --- | --- |
| `pnpm prisma db seed` | Personal bootstrap — code-owned catalog + your captured config, upsert-only | yes |
| `pnpm seed:personal` | Same script, called directly | yes |
| `pnpm seed:personal:capture` | Captures your current UI config into `data/personal.local.json` | yes (read-only) |
| `pnpm seed:generic` | Generic new-client demo world | **no** — fresh installs only |
| `pnpm seed:apply-taxonomy` | Fills group + brand on the real catalog from product names (`--dry` previews) | yes (fills NULLs only) |
| `pnpm seed:sync-permissions` | Creates catalog `Permission` rows the DB lacks, then grants one to roles (`--roles`) or takes it back (`--revoke-from`). Dry by default; `--apply` writes, `--no-revoke` spares sessions | yes (never deletes a `Permission`) |
| `pnpm seed:helper-brands` | The brand master (~60 brands) | demo |
| `pnpm seed:helper-all` | `helper-brands`, then `seed:check-docs` | demo |
| `pnpm seed:purge-demo` | `purge-demo-contacts` + `purge-demo-products` | demo only |
| `pnpm seed:purge-vouchers` | Removes vouchers | demo only |
| `pnpm seed:hard-clean` | Removes everything bootstrap does not seed | demo only |
| `pnpm seed:recompute-balances` | Recomputes account balances | yes |

> **No `seed:dummy-*` any more.** Those scripts were deleted — see `docs/seeds.md`.

### 2.5 Tests and one-off utilities

| Command | What it does |
| --- | --- |
| `pnpm test:e2e` | Playwright run |
| `pnpm test:e2e:ui` | Playwright UI mode |
| `pnpm test:e2e:report` | Opens the last report |
| `pnpm reconcile:shop-orders` | Reconciles shop order accounts |
| `pnpm validate:account-linked-flow` | Validates the account-linked flow |
| `pnpm recompute:caches` | Reports drift in the saved totals (`Account.balance`, `InvProduct.stock`, `InvProductBranch.stock`, gift-card balances) against their ledgers; `--fix` writes the ledger figure. Run `--fix` only on a build that has the 2026-10-24 stock-writer fixes, or the totals drift again |
| `pnpm report:ps-double-count` | **Report only** (read-only transaction): posted Physical Stock counts that probably added the opening twice, checked against the old and the fixed formula. `--csv <file>` also writes a CSV. A person decides each line |

---

## 3. Combined commands, fully expanded

These are the ones people trip over, because one word hides six steps.

### `pnpm build`
1. `scripts/strip-build.ts` — on `APP_MODE=public` only, deletes office-only source. No-op in every other mode.
2. `prisma generate`
3. `scripts/counter-build.ts` — renames desktop-useless routes out of `src/app` for the duration of `next build`, then restores them in a `finally`.

### `pnpm electron:build`
Loads `.env` **first** (this is what decides `APP_MODE` and `LANDING_PAGE`), warns if `resources/pgsql` is missing, then:
1. `pnpm build` (the three steps above)
2. `scripts/prepare-standalone.ts`
3. `scripts/generate-counter-env.ts` → writes `resources/counter.env`
4. `pnpm electron:compile`
5. `scripts/prepare-electron-deps.ts`
6. `scripts/prepare-bridge-deps.ts`
7. `scripts/build-update-splash.ts` → writes `resources/AbeerSuiteUpdateSplash.exe`

### `pnpm electron:pack`
1. `pnpm electron:build` (all seven steps above)
2. `electron-builder --dir` → `dist-app/win-unpacked`
3. `pnpm verify:package`

### `pnpm electron:dist`
Same as `pack`, but `electron-builder` without `--dir`, so you get the NSIS installer.

### `pnpm electron:release`
1. `pnpm electron:pack` (everything above, gate included)
2. `scripts/release-electron.ts` — reads `GITHUB_UPDATE_REPO_N` / `GH_TOKEN_N` pairs from `.env`, then runs `electron-builder --publish always --prepackaged dist-app/win-unpacked`

The `--prepackaged` part is the important design choice: it publishes the **exact tree that just passed `verify:package`**, instead of rebuilding. There is no window where an unverified build can reach the public release.

### `pnpm precommit`
`check-doc-sync --strict` → `check-nav-icons` → `gen-sync-registry --check` → `gen-local-schema --check` → `check-counter-mode vercel` → `check-counter-mode counter` → `check-guard-lint`

### `pnpm seed:helper-all`
`helper-brands` → `seed:check-docs`

`helper-brands` is the only helper left. The other two were deleted for the same
reason — each described a **different business using our ids**. `helper-roles`
upserted `R2` / `R3` as "Role-Service Engineer" / "Role-Counter / Cashier" in other
departments and rewrote their grants every run; `helper-inventory-masters` seeded a
rival taxonomy sharing exactly one name with ours. Roles, grants, department pools,
categories and product groups all come from the personal snapshot now; see
`docs/seeds.md`.

### `pnpm seed:purge-demo`
`seed:purge-demo-contacts` → `seed:purge-demo-products`

---

## 4. Journey A — full release, code to GitHub

Use this when the release contains schema changes, new routes, new permissions, or anything touching sync.

**Step 0 — machine is ready (once only)**

```bash
pnpm install && pnpm install:git-hooks && pnpm pg:fetch
```

`GITHUB_UPDATE_REPO_1` + `GH_TOKEN_1` (and `_2`, …) must exist in `.env` — each token a fine-grained PAT scoped to only that repo, permission *Contents: Read and write*. Counters read from `GITHUB_DOWNLOAD_UPDATE_REPO` with `GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN` (*Contents: Read-only*), so at least one publish target must be that same repo, and it must be a releases-only repo, never the source. The write tokens must **never** enter `scripts/counterEnv.ts`'s `COUNTER_ENV_COPIED`; a shipped counter must not be able to create releases.

**Step 1 — write the code**

Work in `pnpm electron:dev` so the desktop shell exercises the change, not only the browser.

**Step 2 — same-commit companions** (this is the step people forget)

- Schema change → `pnpm sync:tables` and `pnpm db:local-schema`
- Permission change → add it to `src/shared/lib/auth/permissionCatalog.ts` + `permissions.ts`, then `pnpm prisma db seed` (note: that also runs the R1 top-up — see `docs/seeds.md`)
- Config / master-data change → `pnpm seed:personal:capture`, and update `permissionCatalog.ts` / `codeOwnedCatalog.ts` / `personal.local.json`
- Behaviour / route / API change → update `PROJECT_BRAIN.md`, then `/sync-docs-with-code`

**Step 3 — check the DB actually applies**

```bash
pnpm prisma db seed
```

**Step 4 — guards**

```bash
pnpm precommit
```

If docs drift is the only complaint: `pnpm seed:fix-docs`, review the diff, run `precommit` again.

**Step 5 — tests**

```bash
pnpm lint && pnpm test:e2e
```

**Step 6 — land on `main`, then commit and bump**

Releases only ever go out from `main` (§0). Merge the work across and stay there for the rest of this journey:

```bash
git checkout main && git merge --ff-only dev
```

Bump `version` in `package.json`. This number is the release tag and what the updater compares against, so it must go up on every publish.

Rewrite `RELEASE_NOTES.md` for this version. The first line decides how counters take the update (see section 9): put `[urgent]` in the heading only when every counter must restart today.

**Schema change? Publish first, migrate second.** The counter build carries the new `local-schema.sql`, and the sync worker tolerates a replica that is AHEAD of Supabase (extra columns) but halts on one that is BEHIND (missing columns). Push the release, let counters pick it up, then apply the schema to Supabase. The reverse order pauses billing on every replica counter until the update lands — the app does recover on its own (the halt triggers an immediate update check and a 5-minute countdown), but nobody wants that at 6 pm.

**Step 7 — pick the variant**

`.env` decides `APP_MODE` and `LANDING_PAGE` — and, for a `WRITE_MODE=v_live` build, `WRITE_API_URL` and the office's `AUTH_SECRET`, which `generate-counter-env.ts` refuses to build without. Set them there before building — the file is read at the top of `electron:build` and nowhere later.

`.env.local` is deliberately **not** loaded, and that is a safety property rather than an oversight: every build step is spawned with a copy of this environment, and `generate-counter-env.ts` falls back to `process.env` for any key `.env` does not supply, so anything loaded here can be baked into the installer. `.env.local` holds web-version dev overrides — a `READ_MODE` or `DATABASE_URL` uncommented for an afternoon's web work would otherwise decide what ships to every counter. See the comment at the top of `scripts/electron-build.ts`.

**Step 8 — build and gate**

```bash
pnpm electron:pack
```

Watch for two warnings: `resources/pgsql is missing` (the installer would ship without the local replica — every read goes to Supabase forever), and an unusual `APP_MODE`. `verify:package` failing is a hard stop, never a thing to bypass.

**Step 9 — smoke test the real binary**

Run `dist-app/win-unpacked/AbeerSuite.exe`. Confirm login, one local read, and one sync round trip.

**Step 10 — push `main` to both remotes, then publish**

```bash
git push origin main && git push production main
pnpm electron:release
```

This re-runs `electron:pack` and then publishes the verified tree.

**Step 11 — confirm**

Check the release on GitHub: installer, `latest.yml`, and the blockmap must all be there. `latest.yml` missing means auto-update is broken for every existing counter.

**Step 12 — the tag to `production`, and `dev` back level**

`electron:release` pushed `main` and the tag to `origin` only, so finish the convention (§0):

```bash
git push production main --tags
git checkout dev && git merge --ff-only main && git push origin dev
```

Verify — both should print nothing:

```bash
git log origin/main..main --oneline
git log production/main..main --oneline
```

---

## 5. Journey B — minor touch release

For a colour change, a label fix, a spacing tweak, a copy edit — **no schema, no routes, no permissions, no sync, no env**.

1. Edit the code
2. `pnpm electron:dev` — see it
3. `pnpm precommit` — still run this, it takes seconds
4. `git checkout main && git merge --ff-only dev` — a touch release is still a release, so it goes out from `main` (§0)
5. Bump `version` in `package.json` and rewrite `RELEASE_NOTES.md` — a touch release still gets crafted notes
6. **Commit.** The tag `electron:release` creates points at `HEAD`, so the bump and the notes must already be committed
7. `git push origin main && git push production main`
8. `pnpm electron:release`
9. Check the installer, blockmap and `latest.yml` on every release repo
10. `git push production main --tags` (levels `main` and older tags — `electron:release` already pushed the release tag to every release repo before publishing), then level `dev`, and fast-forward `d_office` / `d_shop` when Vercel needs it — the owner pushes those (§0)

**What is skipped, and why it is safe:**

| Skipped | Safe because |
| --- | --- |
| `sync:tables` / `db:local-schema` | Both are generated from `prisma/schema/`. No schema change means no drift — and `precommit` runs the `--check` halves anyway, so a mistake here is caught, not missed |
| `prisma db seed` | No config, catalog or permission changed |
| `seed:personal:capture` | Nothing in the UI config changed |
| `test:e2e` | A colour does not change behaviour. Run it anyway if the change touched layout, a form, or anything clickable |
| `pg:fetch` | Already on the machine and version-pinned |
| Step 9 smoke test | The gate plus a dev-window check is enough for a cosmetic change |

**Never skipped, even for one colour:** `pnpm precommit`, the version bump, and `verify:package` (which you get free inside `electron:release`). The gate is not about your change — it is about what `electron-builder` silently does to the package tree on any build.

---

## 6. Why it feels like command hell

It is not disorganisation. Four separate causes stack up:

1. **One source tree, four products.** The same `src/` builds the Vercel public site, the Vercel office app, the desktop office build, and the desktop counter. Every variant needs its own build wrapper — that is `strip-build`, `counter-build`, `electron-build`, `generate-counter-env`.
2. **The counter has a local database.** A replica means a table registry, a DDL generator, and drift checks for both — four commands (`sync:tables`, `sync:tables:check`, `db:local-schema`, `db:local-schema:check`) that a plain web app simply does not have.
3. **The seed layer is split by ownership on purpose.** Code-owned, generic-demo, trade-helper, personal-real, purge — five categories, and each needed its own entry point so a small change never forces a full reset. (A sixth, `dummy`, was deleted in 2026-09 — demo data that nobody ran.)
4. **Past bugs became permanent guards.** `verify:package`, `check:counter-mode`, `check:guard-lint`, `check:nav-icons` all exist because something shipped broken once. They look like clutter; they are the reason the same thing has not shipped twice.

**The honest fix is not fewer scripts — it is fewer scripts you have to *remember*.** That is already true today: `precommit` hides seven, `electron:release` hides ten. Realistically you type six commands (§1) and the chains do the rest.

---

## 7. Classification of every command

### 7.1 Most important — the six you actually type

`pnpm dev` · `pnpm electron:dev` · `pnpm precommit` · `pnpm prisma db seed` · `pnpm electron:pack` · `pnpm electron:release`

### 7.2 Combined (they run other commands)

`build` · `electron:build` · `electron:pack` · `electron:dist` · `electron:release` · `precommit` · `seed:helper-all` · `seed:purge-demo` — all expanded in §3.

### 7.3 Run once per machine

`pnpm install:git-hooks` · `pnpm pg:fetch` · `pnpm icon:build`

### 7.4 Optional — run only when the situation calls for it

- `electron:compile` — the chains call it for you
- `electron:dist` — only when you need the NSIS installer rather than a folder
- `verify:package` — already inside `pack` / `dist` / `release`; run alone only to re-check an old `dist-app`
- `build:downloader` — only when the web-setup stub changes
- `start` — no real use in this repo
- `seed:fix-docs` — only after `seed:check-docs` complains
- `sync:tables`, `db:local-schema` — only after a schema change
- `test:e2e:ui`, `test:e2e:report` — debugging aids
- All `seed:purge-*` — demo DB only
- `reconcile:shop-orders`, `validate:account-linked-flow` — data repair, not a workflow step

### 7.5 Spent scripts — deleted, not kept

This section used to list six one-shot appliers as "keep the file, almost never run it".
**That was the wrong call and they are now deleted**, along with seven `migrate-*` scripts,
two duplicated voucher-series appliers, a debug scratchpad, all seven `dummy-*` seeds, and
an 827 KB spreadsheet in `prisma/seeds/data/` that nothing read. `prisma/seeds/` went from
41 files to 15.

A spent patch is not documentation. What changed is recorded in `bootstrap-seed.ts` (the
data) and `PROJECT_BRAIN.md` (the reasoning); a dead script alongside them only raises the
question "should I run this?" every time somebody reads the folder. Git history keeps them
if a body is ever needed.

The rule going forward: **a script earns a place in `prisma/seeds/` only if it will be run
more than once.** A one-time fix that ships with a schema change goes into
`bootstrap-seed.ts` plus a line in the commit message — not into a new file.

There are two appliers: `seed:apply-taxonomy` and `seed:sync-permissions`. The rest were
deleted once it was clear the code already did their job: `seed:apply-permissions` (the
permission catalog is the source of truth and both seeds apply it in full) and
`seed:apply-voucher-series-counters` (`ensureVoucherSeries` creates the counter-1 rows, and
`GET /api/accountancy/voucher-series` runs it on every request from the office or Vercel, so
the rows self-heal just by opening the page — never on a local-write counter, whose replica
is a mirror; the one-time fixups with deletes run only from the seed scripts via
`seedVoucherSeries`).

Shipping a permission is normally a plain `pnpm prisma db seed`. `seed:sync-permissions`
exists for the case where that hammer is too big — chiefly a **new nav link**, which
auto-derives a `ui:sidebar:*` permission that no database has yet. It re-earns its place on
every future nav addition, and unlike the old `apply-permissions` it embeds no permission
list: it imports `PERMISSION_CATALOG` and takes the policy from its flags, so there is
nothing in it that can go stale.

The one-off throwaways that used to sit in `scripts/` (the `tmp-*` checks, the call-log
probes, the R-GUEST drop) were deleted on 2026-09-30; `test-tally-date.ts` stays — it is a
real check of the Tally date parser (`pnpm tsx scripts/test-tally-date.ts`).

### 7.6 New in this repo — not in the webapp

Everything below exists because of the desktop counter and its local replica. None of it applies to the Vercel-only webapp.

**Electron / packaging:** `electron:dev` · `electron:compile` · `electron:build` · `electron:pack` · `electron:dist` · `electron:release` · `verify:package` · `icon:build` · `build:downloader` · `pg:fetch`

**Local replica and sync:** `sync:tables` · `sync:tables:check` · `db:local-schema` · `db:local-schema:check` · `check:counter-mode`

**Build-variant machinery inside `pnpm build`:** `strip-build.ts` · `counter-build.ts` · `generate-counter-env.ts` · `prepare-standalone.ts` · `prepare-electron-deps.ts` · `prepare-bridge-deps.ts`

Carried over from the webapp and unchanged in spirit: `dev`, `build`, `start`, `lint`, the whole `seed:*` family, `test:e2e*`, `check:nav-icons`, `check:guard-lint`, `seed:check-docs`.

---

## 8. Release safety rules — short version

1. `GH_TOKEN_N` write tokens live in the build machine's `.env` only. Never in `counterEnv.ts`'s `COUNTER_ENV_COPIED`.
2. Never run `scripts/release-electron.ts` directly. It refuses without `dist-app/win-unpacked/AbeerSuite.exe`, but the point is that `electron:pack` must run first.
3. Never bypass `verify:package`.
4. Bump `version` on every publish, without exception.
5. `resources/pgsql` missing = an installer with no local replica. Warning only, never ignore it for a real release.
6. No `latest.yml` on the release = auto-update is dead for every counter already in the field.
7. Every release repo, or none. `RELEASE_ONLY_REPO=` is a retry after a partial failure, never the normal path.
8. Both source remotes carry the commit and the tag. `electron:release` pushes `origin`; you push `production` yourself.
9. `RELEASE_NOTES.md` is rewritten for every version. Stale notes ship the wrong urgency tier to every counter.
10. Releases go out from `main` only. Check `git branch --show-current` before you type `electron:release`.

---

## 9. How counters take an update

`electron/updateManager.ts` checks the feed 20 s after boot and every 30 minutes, downloads in the background, and then picks one of three tiers. Nothing is shown until the download is complete.

| Tier | Trigger | On screen | Installs |
| --- | --- | --- | --- |
| quiet | Every release by default | Corner card: Restart now / Later | Only at a safe moment: empty POS cart and (window in the tray, or the login page, or no input for 10 min). Never forced. Also on a clean quit. |
| urgent | `[urgent]` in `RELEASE_NOTES.md` | Blocking dialog with a countdown | When the cart is empty and hands are off for a minute; at 30 min regardless |
| schema | The counter's own sync worker halted on `SCHEMA DRIFT` | The same dialog, schema wording, above ReplicaReadyGate | Check runs at once; installs like urgent, at 5 min regardless |

The install is silent and relaunches the app, so a counter that updated overnight is back on the login screen by morning.

**Testing without a GitHub release.** A folder served over HTTP with `latest.yml` + the installer is a valid feed:

```bash
UPDATE_FEED_URL=http://127.0.0.1:8765/ UPDATE_DRY_RUN=1 pnpm electron:dev
```

`UPDATE_FEED_URL` also switches the updater on in dev. `UPDATE_DRY_RUN=1` logs the install decision instead of running the installer, so the fake `latest.yml` can point at any file (electron-updater still verifies its `sha512` and `size`). Shorten the waits with `UPDATE_IDLE_SECONDS`, `UPDATE_URGENT_IDLE_SECONDS`, `UPDATE_URGENT_GRACE_MINUTES`, `UPDATE_SCHEMA_GRACE_MINUTES`. Both vars are honoured by a packaged build too, via the per-machine `%APPDATA%/abeersuite-electron/.env`, which is how one counter can be pointed at a test feed. The tray's "Check for updates" skips the 30-minute wait.

**When a counter says "checking failed".** `%APPDATA%/abeersuite-electron/logs/main.log` has every `[Updater]` line. A `404` on `/releases/latest` means the repo in `GITHUB_DOWNLOAD_UPDATE_REPO` has no release, or the baked PAT was not granted *Contents: Read* on it.
