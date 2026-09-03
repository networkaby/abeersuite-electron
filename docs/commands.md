# Command Book — every `pnpm` script in this repo

One place that answers: *what does this command do, when do I run it, and can I skip it?*

- **Repo:** `abeersuite-electron` (Next.js app + Electron desktop counter + sync engine)
- **App version at time of writing:** `0.3.1`
- **Release target:** `devloperakramul/abeersuite-networkservice-update` (updater feed) and `devloperakramul/abeersuite-electron` (origin releases)
- **Package manager:** `pnpm` only

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
| `pnpm electron:build` | Loads `.env.counter`, then runs the whole desktop build chain (see §3) |
| `pnpm electron:pack` | `electron:build` → `electron-builder --dir` → `verify:package` — unpacked folder, no installer |
| `pnpm electron:dist` | `electron:build` → `electron-builder` → `verify:package` — makes the real installer |
| `pnpm electron:release` | `electron:pack` → `release-electron.ts` — publishes the **already verified** tree to GitHub |
| `pnpm verify:package` | The build gate — checks the packaged tree for missing `node_modules`, symlinks into the pnpm store, stray `.env` files, and secrets outside the `counter.env` allowlist |
| `pnpm pg:fetch` | Downloads + trims the embedded PostgreSQL into `resources/pgsql` (~80 MB). **Once per build machine**, again on a version bump |
| `pnpm icon:build` | Regenerates the app icon |
| `pnpm build:downloader` | Compiles the small C# web-setup stub `AbeerSuite-WebSetup.exe` |

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
| `pnpm check:counter-mode` | Counter/vercel routing guards, runs with **no database** | yes (both modes) |
| `pnpm check:guard-lint` | Every API route is guarded unless allowlisted | yes |
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
| `pnpm seed:apply-permissions` | Applies the `ADDITIONS` permission list | yes |
| `pnpm seed:apply-*` (delivery-methods, help-pipeline, status-entered-at, credit-card-group, account-groups, workgroup-name) | Small targeted idempotent fixes | yes |
| `pnpm seed:helper-brands` / `-inventory` / `-roles` | Trade master data | demo |
| `pnpm seed:dummy-*` (users, org-rich, shop, customers, vouchers, tasks, deals) | Individual dummy data sets | demo only |
| `pnpm seed:dummy-all` | All dummy seeds in order, then `seed:check-docs` | demo only |
| `pnpm seed:purge-demo` | `purge-demo-contacts` + `purge-demo-products` | demo only |
| `pnpm seed:purge-vouchers` | Removes dummy vouchers | demo only |
| `pnpm seed:hard-clean` | Removes dummy/helper data only | demo only |
| `pnpm seed:recompute-balances` | Recomputes account balances | yes |

### 2.5 Tests and one-off utilities

| Command | What it does |
| --- | --- |
| `pnpm test:e2e` | Playwright run |
| `pnpm test:e2e:ui` | Playwright UI mode |
| `pnpm test:e2e:report` | Opens the last report |
| `pnpm reconcile:shop-orders` | Reconciles shop order accounts |
| `pnpm validate:account-linked-flow` | Validates the account-linked flow |

---

## 3. Combined commands, fully expanded

These are the ones people trip over, because one word hides six steps.

### `pnpm build`
1. `scripts/strip-build.ts` — on `APP_MODE=public` only, deletes office-only source. No-op in every other mode.
2. `prisma generate`
3. `scripts/counter-build.ts` — renames desktop-useless routes out of `src/app` for the duration of `next build`, then restores them in a `finally`.

### `pnpm electron:build`
Loads `.env.counter` **first** (this is what decides `APP_MODE` and `LANDING_PAGE`), warns if `resources/pgsql` is missing, then:
1. `pnpm build` (the three steps above)
2. `scripts/prepare-standalone.ts`
3. `scripts/generate-counter-env.ts` → writes `resources/counter.env`
4. `pnpm electron:compile`
5. `scripts/prepare-electron-deps.ts`
6. `scripts/prepare-bridge-deps.ts`

### `pnpm electron:pack`
1. `pnpm electron:build` (all six steps above)
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

### `pnpm seed:dummy-all`
`dummy-customers` → `helper-roles` → `dummy-users` → `helper-brands` → `helper-inventory` → `dummy-shop` → `dummy-vouchers` → `dummy-tasks` → `dummy-deals` → `seed:check-docs`

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
- Permission change → update `ADDITIONS`, then `pnpm seed:apply-permissions`
- Config / master-data change → `pnpm seed:personal:capture`, and update `lib/codeOwnedCatalog.ts` / `personal.local.json`
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

**Step 6 — commit and bump**

Bump `version` in `package.json`. This number is the release tag and what the updater compares against, so it must go up on every publish.

Rewrite `RELEASE_NOTES.md` for this version. The first line decides how counters take the update (see section 9): put `[urgent]` in the heading only when every counter must restart today.

**Schema change? Publish first, migrate second.** The counter build carries the new `local-schema.sql`, and the sync worker tolerates a replica that is AHEAD of Supabase (extra columns) but halts on one that is BEHIND (missing columns). Push the release, let counters pick it up, then apply the schema to Supabase. The reverse order pauses billing on every replica counter until the update lands — the app does recover on its own (the halt triggers an immediate update check and a 5-minute countdown), but nobody wants that at 6 pm.

**Step 7 — pick the variant**

`.env.counter` decides `APP_MODE` and `LANDING_PAGE`. Set it before building — it is read at the top of `electron:build` and nowhere later.

**Step 8 — build and gate**

```bash
pnpm electron:pack
```

Watch for two warnings: `resources/pgsql is missing` (the installer would ship without the local replica — every read goes to Supabase forever), and an unusual `APP_MODE`. `verify:package` failing is a hard stop, never a thing to bypass.

**Step 9 — smoke test the real binary**

Run `dist-app/win-unpacked/AbeerSuite.exe`. Confirm login, one local read, and one sync round trip.

**Step 10 — publish**

```bash
pnpm electron:release
```

This re-runs `electron:pack` and then publishes the verified tree.

**Step 11 — confirm**

Check the release on GitHub: installer, `latest.yml`, and the blockmap must all be there. `latest.yml` missing means auto-update is broken for every existing counter.

**Step 12 — push**

Push the branch and the version bump.

---

## 5. Journey B — minor touch release

For a colour change, a label fix, a spacing tweak, a copy edit — **no schema, no routes, no permissions, no sync, no env**.

1. Edit the code
2. `pnpm electron:dev` — see it
3. `pnpm precommit` — still run this, it takes seconds
4. Bump `version` in `package.json`
5. `pnpm electron:release`
6. Check `latest.yml` on the release
7. Commit and push

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
3. **The seed layer is split by ownership on purpose.** Code-owned, generic-demo, trade-helper, personal-real, dummy, purge — six categories, and each needed its own entry point so a small change never forces a full reset.
4. **Past bugs became permanent guards.** `verify:package`, `check:counter-mode`, `check:guard-lint`, `check:nav-icons` all exist because something shipped broken once. They look like clutter; they are the reason the same thing has not shipped twice.

**The honest fix is not fewer scripts — it is fewer scripts you have to *remember*.** That is already true today: `precommit` hides seven, `electron:release` hides ten. Realistically you type six commands (§1) and the chains do the rest.

---

## 7. Classification of every command

### 7.1 Most important — the six you actually type

`pnpm dev` · `pnpm electron:dev` · `pnpm precommit` · `pnpm prisma db seed` · `pnpm electron:pack` · `pnpm electron:release`

### 7.2 Combined (they run other commands)

`build` · `electron:build` · `electron:pack` · `electron:dist` · `electron:release` · `precommit` · `seed:dummy-all` · `seed:purge-demo` — all expanded in §3.

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
- All `seed:dummy-*` and `seed:purge-*` — demo DB only
- `reconcile:shop-orders`, `validate:account-linked-flow` — data repair, not a workflow step

### 7.5 Spent — keep the file, almost never run it

These are one-shot migrations already applied everywhere. Keep them (they are idempotent and they document what changed), but they are not part of any journey.

| Command | Last touched |
| --- | --- |
| `seed:apply-delivery-methods` | 2026-07-22 |
| `seed:apply-help-pipeline` | 2026-07-24 |
| `seed:apply-status-entered-at` | 2026-07-24 |
| `seed:apply-credit-card-group` | 2026-07-29 |
| `seed:apply-account-groups` | 2026-07-29 |
| `seed:apply-workgroup-name` | 2026-07-30 |

`seed:apply-permissions` is **not** in this list — it is live, and required whenever `ADDITIONS` changes.

**Loose ends worth cleaning (not done in this doc):**

- `prisma/seeds/apply-taxonomy.ts` and `apply-test-shop-products.ts` exist but have **no `pnpm` script** — either add one or fold them in.
- `scripts/` still holds obvious throwaways: `tmp-check-apportioned-vouchers.ts`, `tmp-check-unit-cols.ts`, `inspect-call-raw.ts`, `survey-call-keys.ts`, `test-tally-date.ts`, `drop-rguest.sql`.

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
