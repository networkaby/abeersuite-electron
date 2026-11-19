---
name: release
description: Carry out a full AbeerSuite release end to end — merge dev into main, bump the version, craft RELEASE_NOTES.md, commit, push to both remotes, build and publish with `pnpm electron:release` (tag + GitHub release upload), push the tag to production, and, when the release touches what Vercel serves, fast-forward d_office and d_shop locally (the owner pushes them). Use when the owner says "do a release", "release", "publish a version", "ship 5.0.4", "make a new build for the counters", or asks for a tag + GitHub release of this app.
---

# Do a release

**"Do a release" is one instruction for this whole list, not for one command.** Do not stop after `pnpm electron:release` and hand the rest back. Every step below, in order, every time. If a line is skipped, it was not a release.

Sources of truth: `AGENTS.md` §9 and `docs/commands.md` §0 (the convention) and §9 (how counters take the update). This skill is the runbook; those two files are the law.

## Ground rules

- **`/release urgent` = no questions.** The owner has already decided: `minimumCounterVersion` is raised to this version, the `.env` variant is taken as it is (state `APP_MODE` / `LANDING_PAGE` in the report), and the notes are written and committed without waiting. Run the whole list straight through. Failures (non-fast-forward, `verify:package`, publish) still stop.

- **`dist-v*` tags are not release material.** They are local markers for `dist` test builds (`.claude/skills/dist/SKILL.md`). `release` never reuses their installer, never builds on them, never pushes them — it always builds fresh with `pnpm electron:release`. A release supersedes every test build made before it (one that was tested and dropped, or skipped straight past), so preflight deletes them.
- **`main` only.** Never release from `dev`, `d_office`, or a detached HEAD. The tag the script mints points at `HEAD`, so releasing off `dev` puts `v<version>` on a commit `main` does not contain and the two remotes stop agreeing about what that version is.
- **Two source remotes, both must end level.** `origin` = `devloperakramul/abeersuite-electron`, `production` = `akramuljakir/abeersuite-electron`.
- **Release is the one exception to "never push".** Steps 5, 7 and 8 are pushes the owner asked for by saying the word "release". The `d_office` / `d_shop` pushes in step 9 are **not** — the owner runs those; the agent only reminds. Everything else in this repo still stops at the commit.
- **Publish as soon as possible — no pauses.** No smoke-test stop, no waiting for the owner to test — the only questions are the notes/urgency tier and the variant. If something in the release looks risky and untested, test it yourself (tsc, lint, drive the dev server, run the packed exe) and carry on.
- **A `-` in the version makes it a test build.** `1.3.1-pre.1` publishes to `GITHUB_UPDATE_REPO_2` **only**, marked a GitHub prerelease. A version with no `-` publishes to **every** repo. The gate is in `scripts/release-electron.ts` and needs nothing set by hand — do not reach for `RELEASE_ONLY_REPO` to get this, that is the retry path.
  - Repo 1 is what the tills update from (`GITHUB_DOWNLOAD_UPDATE_REPO` → `electron/updateManager.ts`). Publishing there reaches real counters.
  - Repo 2 is the test channel. Counters never poll it, and `allowPrerelease` is off, so a test build cannot reach a till by accident.
  - A test build still comes off `main` like any other — the `main`-only rule above is not relaxed for it.
- **Never** tag by hand, push a tag on its own, draft a release or upload a binary in the GitHub web UI, run `scripts/release-electron.ts` directly (it bypasses the `verify:package` gate — the `publish` skill is the one exception, and only because the owner's own `pnpm electron:dist` already ran that gate), publish to one release repo and leave another behind **when the version has no `-`**, or reuse last version's notes.

## Preflight

Run these before touching anything, and report what you find:

```bash
git status --porcelain && git branch --show-current && git log --oneline -1
```

- Working tree clean? Uncommitted work must be resolved or stashed first — ask the owner, never discard.
- `.env` present with `GITHUB_UPDATE_REPO_1` + `GITHUB_UPDATE_REPO_1_TOKEN` (the script scans `_1`, `_2`, … until a gap; a repo with no matching token is fatal).
- **Clear `dist-v*` markers** — skipped or abandoned test builds; this release supersedes them. Local only, nothing on GitHub to undo:

  ```bash
  git tag -l "dist-v*" && git tag -l "dist-v*" | xargs -r git tag -d
  ```

  Name them in the report. One for a version **above** the one you are releasing means a test build is ahead of this release — stop and ask instead of deleting.
- **Ask the owner to confirm the build variant** — `APP_MODE` and `LANDING_PAGE` in `.env` decide which product this installer is. Do not guess.

**Stop anything that can lock the build, before step 6 — not after it fails.** `electron-builder` unpacks Electron into `dist-app/win-unpacked.tmp` and renames it to `dist-app/win-unpacked`. A leftover `AbeerSuite.exe` (an earlier smoke test still open) or `electron.exe` (a `pnpm dev` / `pnpm electron:dev` session still running) holds those files open and turns that rename into `EPERM: operation not permitted, rename 'win-unpacked.tmp' -> 'win-unpacked'` — a real failure, unlike the transient antivirus one covered by the EPERM-resumable memory. A dev server left on port `786` (`electron:dev`) or `3000` (`pnpm dev`) can just as easily clash with the fresh `.next` output the same pack step writes.

```powershell
Get-NetTCPConnection -LocalPort 3000,786 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Get-Process -Name AbeerSuite, electron -ErrorAction SilentlyContinue | Stop-Process -Force
# Anything else still running out of dist-app (an old installer, a helper exe)
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$PWD\dist-app\*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

# Clear the unpack folders and any installer already built for THIS version
$v = (Get-Content package.json -Raw | ConvertFrom-Json).version
$stale = @('dist-app\win-unpacked.tmp', 'dist-app\win-unpacked') +
  (Get-ChildItem dist-app -Filter "*$v*" -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.exe', '.blockmap' } | ForEach-Object FullName)
$stale | ForEach-Object { Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue }

# Proof: every path must be gone, or something still holds it
$left = $stale | Where-Object { Test-Path $_ }
if ($left) { "STILL LOCKED: $left" } else { 'dist-app clear' }
```

Run this **after step 2** (the version bump), so `$v` is the new version. If it prints
`STILL LOCKED`, do not start the build — an Explorer window, a terminal `cd`'d into
`dist-app`, or antivirus holds the folder. Close that handle (ask the owner if it is
their window), re-run the block until it prints `dist-app clear`, then go on. A build
started over a locked folder fails ~5 minutes later at the `win-unpacked.tmp` rename.

If this closes a `pnpm electron:dev` window the owner had open, say so in the report — it starts again with the same command once the build is done.

## The ten steps

### 1. Get on `main` with the release content

```bash
git checkout main && git merge --ff-only dev
```

Not fast-forwardable means `main` carries something `dev` does not. **Stop and report. Never force, never turn it into a merge commit to get past it.**

### 2. Bump `version` in `package.json`

This number is the tag, the GitHub release name, and what every counter's updater compares against. It goes up on every publish, no exception.

Patch (`5.0.3` → `5.0.4`) for fixes; minor for new capability; ask the owner when it is not an obvious bump. Only the top-level `"version"` field changes.

### 3. Craft `RELEASE_NOTES.md` — write it yourself

Rewritten from scratch for this version. Not appended to, not left from last time.

```bash
git log $(git describe --tags --match "v*" --abbrev=0)..HEAD --pretty=format:"%h %s"
```

Read the actual diffs behind those commits — subject lines are not enough to know what a shopkeeper will notice.

**What the file must be:**

- **Customer-readable.** Plain Indian English, project vocabulary (`docs/vocabulary.md`). "The Offline Policies page now works", not "fix(policies): persist toggles to DB".
- **Grouped by what a user notices** — one `##` heading per area (counter setup, billing, sync, printing), each with short bullets.
- **First line is `# v<version>`** — never `[urgent]`; the release script adds or strips it from the minimum. Then one short paragraph saying who should install it and why.
- **Call out a schema change explicitly** if the release adds or changes a table — say the counter must be updated first, and that its sync pauses until it is. The order is not a preference: `schemaGuard` halts a counter on a column the SOURCE has and the replica lacks, so migrating Supabase first makes every till print `SCHEMA DRIFT — refusing to sync` and stop **all** its tables, not just the changed one. Build first, migrate within minutes (`docs/commands.md` §0).

**`minimumCounterVersion` in `package.json` decides how counters take it** (`docs/commands.md` §9, `electron/updateManager.ts`). It is the oldest version a counter may keep running; each counter compares its own version with it.

| Decision | When | What a counter sees |
| --- | --- | --- |
| **Raise** it to this version → urgent | A migration, a common API, sync, sign-in / permissions, the counter app's own core, a serious POS bug | Below the minimum: blocking dialog with a countdown, installs at 30 min regardless. |
| **Leave** it → quiet | One module or screen: bank reconciliation, a report, UI, colours | Corner card: Restart now / Later. Never installs by itself, not even on quit — staff may skip it until the next urgent one. |
| schema | *(not chosen here — a counter picks this itself when its sync worker halts on `SCHEMA DRIFT`)* | Same dialog, schema wording. Installs at 5 min regardless. |

Raising it interrupts cashiers mid-sale — do not spend it on a nice-to-have. A new migration since the last release **must** raise it; `release-electron.ts --preflight` (first in `pnpm electron:release`) refuses otherwise. The version number does not decide urgency — bump it by the kind of change, as before.

**The auto-generated part appends below yours.** `scripts/release-electron.ts` reads `RELEASE_NOTES.md`, then appends `### What's Changed in v<version>` — the raw `git log` since the previous tag plus a compare link — joined with a `---` separator. So the file holds **only** the hand-written half. Do not paste a commit list into it yourself; it would appear twice.

**Show the drafted notes and the minimum (raised or left, and why) to the owner and wait before committing them** — ask once, together with the variant question if it is still open. They know which change customers care about; you only know the commits.

### 4. Commit the bump and the notes on `main`

```bash
git add package.json RELEASE_NOTES.md && git commit -m "chore(release): attempt v<version> - <one line on what this version is>"
```

Stage only these two files — never `git add -A`. The owner keeps local edits and the pack script renames files.

**Write `attempt v<version>`, not a bare `v<version>`.** This commit is made *before* the build runs (step 6), so at this moment nothing is proven — the pack can fail, `verify:package` can refuse, a publish can die halfway. A message that reads like a finished release makes the history lie: `git log` would show `v1.3.8` shipped when no installer ever reached a counter. `attempt v1.3.8` says exactly what happened: the bump and the notes were committed and the build was about to start.

The tag is the proof, not the commit. If the build succeeds, `v<version>` lands on this same commit in step 6 and the history is unambiguous — an `attempt` line carrying a tag is a released version. If it fails, the `attempt` commit stands alone with no tag and the next run tells the truth about it.

Do **not** go back and reword the commit after a successful build. Rewriting it would need a force push to two remotes for no gain.

### 5. Push `main` to both remotes — before building

```bash
git push origin main && git push production main
```

Push first, so the code is on both remotes even if the build then fails.

### 6. Build, tag and publish

```bash
pnpm electron:release
```

One command owns all of this — never do any part of it by hand:

- `pnpm electron:pack` → `electron:build` + `electron-builder --dir` + the **`verify:package` gate** (counter env keys, standalone `server.js` and its dependency closure, resource size, replica payload / `local-schema.sql`).
- Assembles the release notes: your `RELEASE_NOTES.md`, then the auto commit log since the previous version tag, in that order.
- Creates the annotated git tag **`v<version>`** if it does not already exist.
- `git push origin HEAD refs/tags/v<version>` — `main` **and** only the release tag to `origin` (never `--tags`: local `dist-v*` markers must not leave the machine).
- **Publishes a GitHub release.** A normal version goes to **every** `GITHUB_UPDATE_REPO_N`, each with its own `GITHUB_UPDATE_REPO_N_TOKEN` — one `electron-builder --publish always --prepackaged` run per repo, carrying the installer, the blockmap, `latest.yml` and the notes. A version with a `-` in it goes to **repo 2 only**, marked a prerelease; the script says which it is doing before it starts, so read that line.

**No smoke-test pause.** Never stop to ask the owner to test. If the release needs a
check the gate cannot make, do it yourself before or after the pack, then let
`pnpm electron:release` run straight from pack to publish.

### 7. Level `main` and the release tag on `production` (the release tag is already there — `electron:release` pushed it before publishing)

```bash
git push production main refs/tags/v<version>
```

The script pushes `origin` only. Both source remotes must carry the released commit **and** its tag, or the two accounts disagree about what `v<version>` is.

### 8. Bring `dev` back level with `main`

```bash
git checkout dev && git merge --ff-only main && git push origin dev
```

So the next day's work starts from the released tree.

### 9. `d_office` and `d_shop` — fast-forward if Vercel needs it, never push

Both are Vercel deploy branches on `origin`: `d_office` deploys the office site (and runs
`prisma migrate deploy` through `vercel-build`), `d_shop` deploys the shop site. Pushing
`main` or `dev` deploys nothing.

**Does this release need Vercel?** Check what changed since each branch's tip:

```bash
git diff --stat d_office..main
git diff --stat d_shop..main
```

Anything the web side serves counts — `src/app`, `src/shared`, API routes, `prisma/`
(migrations), `public/`, `next.config`, `package.json` deps. Only `electron/`,
installer/packaging scripts, `RELEASE_NOTES.md` and docs → no Vercel change; skip the
branch and say so in the report.

When it does, **fast-forward without asking:**

```bash
git checkout d_office && git merge --ff-only main
git checkout d_shop && git merge --ff-only main
git checkout main
```

Not fast-forwardable → stop and report; that branch carries code no release contains.

**Do not push them.** The owner pushes `d_office` / `d_shop` by hand. Put the reminder
at the very end of the step-10 report, with the commands:

```bash
git push origin d_office
git push origin d_shop
```

**If either is many commits behind, say so loudly** — earlier releases never deployed
(v1.5.0 found `d_office` 15 commits back).

**On a schema release, the counters get the build first** (AGENTS.md §3) — the
`d_office` push is the moment live's schema changes. Check what is pending and put it
in the reminder:

```bash
pnpm db:migrate:status
```

**Post-deploy data steps.** Some migrations need a one-time data script on live after
the `d_office` deploy has applied them. If a pending migration below is listed here,
add its command to the reminder for the owner to run once the deploy is green:

| Migration | Run once on live after deploy |
|---|---|
| `20261103090000_barcode_saved_price` | `pnpm seed:saved-barcodes` — saves today's barcode for products that never had one, so a later Sale Price change stops moving it |

"Database schema is up to date!" → code-only deploy. Anything pending → tell the owner
to push `d_office` only after the tills have updated. Judge drift on what physically
changes: a new table is invisible to old tills; a new **column on a table counters
already sync** is what halts shops. Read the migration SQL, not the schema diff.

If the owner asks for a deploy some other way — `vercel --prod`, the dashboard — say
plainly that the `d_office` / `d_shop` push is the trigger and offer this instead. Do not go looking for
Vercel credentials.

### 10. Report

Done means, and say each one plainly:

- `main` and `v<version>` are on **both** remotes.
- `main` and `dev` are on the released commit.
- Anything you tested yourself.
- **Last line — the Vercel reminder:** which of `d_office` / `d_shop` were fast-forwarded (or skipped, and why), that they are **not pushed** so the sites still run old code, the push commands, and on a schema release that counters must update first.
- **Every** release repo shows the installer, the blockmap, `latest.yml`, and the crafted notes — or, for a `-pre` version, **repo 2 shows them and repo 1 was deliberately left alone**. Say which, and say that counters will not see a test build.
- Which urgency tier went out, and therefore how counters will take it.

## Join hand — where to stop and ask

Handing a step back is **not** stopping the release: do everything either side of it, then pick the list up where you left off. Say plainly what you need and wait.

| Ask for | When |
| --- | --- |
| **The notes and the minimum** | Always, once, before step 4. Show the drafted `RELEASE_NOTES.md` and whether `minimumCounterVersion` goes up to this version. |
| **The variant** | Always, at preflight — `APP_MODE`, `LANDING_PAGE`. |
| **A push they would rather run** | Whenever they say so — offer the exact command instead of running it. |
| **Anything that would be a guess** | A version number that is not an obvious bump; a schema release's publish-then-migrate ordering; a repo that failed to publish. |

## Stop and ask — failures

- **Non-fast-forward merge** (step 1, 8 or 9) → stop, report what diverged. Never force.
- **`verify:package` fails** → stop. The gate exists because these failures reach a counter, not the build machine. Read the named failure, fix the cause, re-run the whole `pnpm electron:release`.
- **Publish fails for one repo after another succeeded** → retry that repo alone:

  ```bash
  RELEASE_ONLY_REPO=<repo-name> pnpm electron:release
  ```

  Retry path only, **never** the normal path. `<repo-name>` is the repo half of `GITHUB_UPDATE_REPO_N`, without the owner.

- **A tag already exists for this version** → the version was not bumped, or a previous run got partway. Do not move or delete the tag; report it and let the owner decide.

## Related files

- `.claude/skills/publish/SKILL.md` — the sibling runbook for a build the owner already made and tested: no merge, no bump, no build, any commit. The notes rules in step 3 are shared, and it points here for them.
- `AGENTS.md` §9 — the release clause the owner holds you to.
- `docs/commands.md` §0 — the full convention; §9 — the update tiers.
- `scripts/release-electron.ts` — tagging, notes assembly, multi-repo publish, `RELEASE_ONLY_REPO`.
- `scripts/verify-package.ts` — the gate, and what each failure means.
- `package.json` — `version`, `electron:pack`, `electron:release`, `verify:package`.
- `electron/updateManager.ts` — how a counter compares itself with the minimum and decides when to install.
- `RELEASE_NOTES.md` — the hand-written half; rewrite it every time.
- `.claude/skills/dist/SKILL.md` — the same preparation stopped before GitHub: local commit, `pnpm electron:dist`, a local `dist-v<version>` marker for `publish` to upload later.
