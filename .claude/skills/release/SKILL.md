---
name: release
description: Carry out a full AbeerSuite release end to end — merge dev into main, bump the version, craft RELEASE_NOTES.md, commit, push to both remotes, build and publish with `pnpm electron:release` (tag + GitHub release upload), push the tag to production, and bring dev level again. Use when the owner says "do a release", "release", "publish a version", "ship 5.0.4", "make a new build for the counters", or asks for a tag + GitHub release of this app.
---

# Do a release

**"Do a release" is one instruction for this whole list, not for one command.** Do not stop after `pnpm electron:release` and hand the rest back. Every step below, in order, every time. If a line is skipped, it was not a release.

Sources of truth: `AGENTS.md` §8 and `docs/commands.md` §0 (the convention) and §9 (how counters take the update). This skill is the runbook; those two files are the law.

## Ground rules

- **`main` only.** Never release from `dev`, `d_office`, or a detached HEAD. The tag the script mints points at `HEAD`, so releasing off `dev` puts `v<version>` on a commit `main` does not contain and the two remotes stop agreeing about what that version is.
- **Two source remotes, both must end level.** `origin` = `devloperakramul/abeersuite-electron`, `production` = `akramuljakir/abeersuite-electron`.
- **Release is the one exception to "never push".** Steps 5, 7 and 8 are pushes the owner asked for by saying the word "release". Everything else in this repo still stops at the commit.
- **A `-` in the version makes it a test build.** `1.3.1-pre.1` publishes to `GITHUB_UPDATE_REPO_2` **only**, marked a GitHub prerelease. A version with no `-` publishes to **every** repo. The gate is in `scripts/release-electron.ts` and needs nothing set by hand — do not reach for `RELEASE_ONLY_REPO` to get this, that is the retry path.
  - Repo 1 is what the tills update from (`GITHUB_DOWNLOAD_UPDATE_REPO` → `electron/updateManager.ts`). Publishing there reaches real counters.
  - Repo 2 is the test channel. Counters never poll it, and `allowPrerelease` is off, so a test build cannot reach a till by accident.
  - A test build still comes off `main` like any other — the `main`-only rule above is not relaxed for it.
- **Never** tag by hand, push a tag on its own, draft a release or upload a binary in the GitHub web UI, run `scripts/release-electron.ts` directly (it bypasses the `verify:package` gate), publish to one release repo and leave another behind **when the version has no `-`**, or reuse last version's notes.

## Preflight

Run these before touching anything, and report what you find:

```bash
git status --porcelain && git branch --show-current && git log --oneline -1
```

- Working tree clean? Uncommitted work must be resolved or stashed first — ask the owner, never discard.
- `.env` present with `GITHUB_UPDATE_REPO_1` + `GH_TOKEN_1` (the script scans `_1`, `_2`, … until a gap; a repo with no matching token is fatal).
- **Ask the owner to confirm the build variant** — `APP_MODE` and `LANDING_PAGE` in `.env` decide which product this installer is. Do not guess.

## The nine steps

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
git log $(git describe --tags --abbrev=0)..HEAD --pretty=format:"%h %s"
```

Read the actual diffs behind those commits — subject lines are not enough to know what a shopkeeper will notice.

**What the file must be:**

- **Customer-readable.** Plain Indian English, project vocabulary (`docs/vocabulary.md`). "The Offline Policies page now works", not "fix(policies): persist toggles to DB".
- **Grouped by what a user notices** — one `##` heading per area (counter setup, billing, sync, printing), each with short bullets.
- **First line is `# v<version>`**, optionally `[urgent]`. Then one short paragraph saying who should install it and why.
- **Call out a schema change explicitly** if the release adds or changes a table — say the counter must be updated first, and that its sync pauses until it is. The order is not a preference: `schemaGuard` halts a counter on a column the SOURCE has and the replica lacks, so migrating Supabase first makes every till print `SCHEMA DRIFT — refusing to sync` and stop **all** its tables, not just the changed one. Build first, migrate within minutes (`docs/commands.md` §0).

**The urgency tier decides how counters take it** (`docs/commands.md` §9, `electron/updateManager.ts`):

| Tier | Written as | What a counter sees |
| --- | --- | --- |
| quiet | *(no marker — the default)* | Corner card: Restart now / Later. Installs only at a safe moment — empty POS cart, window in the tray or on the login page. Never forced. |
| urgent | `[urgent]` in the **first line only** | Blocking dialog with a countdown. Installs at 30 min regardless of what the cashier is doing. |
| schema | *(not chosen here — a counter picks this itself when its sync worker halts on `SCHEMA DRIFT`)* | Same dialog, schema wording. Installs at 5 min regardless. |

`[urgent]` only when **every counter must restart today**. It interrupts people mid-sale — do not spend it on a nice-to-have.

**The auto-generated part appends below yours.** `scripts/release-electron.ts` reads `RELEASE_NOTES.md`, then appends `### What's Changed in v<version>` — the raw `git log` since the previous tag plus a compare link — joined with a `---` separator. So the file holds **only** the hand-written half. Do not paste a commit list into it yourself; it would appear twice.

**Show the drafted notes and the urgency tier to the owner and wait before committing them.** They know which change customers care about; you only know the commits.

### 4. Commit the bump and the notes on `main`

```bash
git add package.json RELEASE_NOTES.md && git commit -m "chore(release): <one line on what this version is>"
```

Stage only these two files — never `git add -A`. The owner keeps local edits and the pack script renames files.

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
- `git push origin HEAD --tags` — `main` **and** the tag to `origin`.
- **Publishes a GitHub release.** A normal version goes to **every** `GITHUB_UPDATE_REPO_N`, each with its own `GH_TOKEN_N` — one `electron-builder --publish always --prepackaged` run per repo, carrying the installer, the blockmap, `latest.yml` and the notes. A version with a `-` in it goes to **repo 2 only**, marked a prerelease; the script says which it is doing before it starts, so read that line.

**Between pack and publish, ask the owner to join hand for the smoke test.** You cannot do this one:

> Please run `dist-app/win-unpacked/AbeerSuite.exe` and confirm login, one local read, and one sync round trip.

Best done on a **clean Windows profile or a VM** — no repo, no pnpm store, no PostgreSQL
installed. Every packaging blocker so far came from the packaged environment differing
from the dev tree, so a pass on a dev machine proves less than it looks.

### 7. Push the tag to `production` too

```bash
git push production main --tags
```

The script pushes `origin` only. Both source remotes must carry the released commit **and** its tag, or the two accounts disagree about what `v<version>` is.

### 8. Bring `dev` back level with `main`

```bash
git checkout dev && git merge --ff-only main && git push origin dev
```

So the next day's work starts from the released tree.

### 9. Report

Done means, and say each one plainly:

- `main` and `v<version>` are on **both** remotes.
- `dev` is level with `main`.
- **Every** release repo shows the installer, the blockmap, `latest.yml`, and the crafted notes — or, for a `-pre` version, **repo 2 shows them and repo 1 was deliberately left alone**. Say which, and say that counters will not see a test build.
- Which urgency tier went out, and therefore how counters will take it.

## Join hand — where to stop and ask

Handing a step back is **not** stopping the release: do everything either side of it, then pick the list up where you left off. Say plainly what you need and wait.

| Ask for | When |
| --- | --- |
| **The notes and the tier** | Always, before step 4. Show the drafted `RELEASE_NOTES.md`. |
| **The smoke test** | Always, after the pack succeeds. You cannot run the packaged exe meaningfully. |
| **The variant** | Always, at preflight — `APP_MODE`, `LANDING_PAGE`. |
| **A push they would rather run** | Whenever they say so — offer the exact command instead of running it. |
| **Anything that would be a guess** | A version number that is not an obvious bump; a schema release's publish-then-migrate ordering; a repo that failed to publish. |

## Stop and ask — failures

- **Non-fast-forward merge** (step 1 or 8) → stop, report what diverged. Never force.
- **`verify:package` fails** → stop. The gate exists because these failures reach a counter, not the build machine. Read the named failure, fix the cause, re-run the whole `pnpm electron:release`.
- **Publish fails for one repo after another succeeded** → retry that repo alone:

  ```bash
  RELEASE_ONLY_REPO=<repo-name> pnpm electron:release
  ```

  Retry path only, **never** the normal path. `<repo-name>` is the repo half of `GITHUB_UPDATE_REPO_N`, without the owner.

- **A tag already exists for this version** → the version was not bumped, or a previous run got partway. Do not move or delete the tag; report it and let the owner decide.

## Related files

- `AGENTS.md` §8 — the release clause the owner holds you to.
- `docs/commands.md` §0 — the full convention; §9 — the update tiers.
- `scripts/release-electron.ts` — tagging, notes assembly, multi-repo publish, `RELEASE_ONLY_REPO`.
- `scripts/verify-package.ts` — the gate, and what each failure means.
- `package.json` — `version`, `electron:pack`, `electron:release`, `verify:package`.
- `electron/updateManager.ts` — how a counter reads `[urgent]` and decides when to install.
- `RELEASE_NOTES.md` — the hand-written half; rewrite it every time.
