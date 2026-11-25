---
name: publish
description: Put an already-built, already-tested AbeerSuite setup on GitHub — write RELEASE_NOTES.md, ask before pushing, tag the current commit and upload the installer to every release repo. Use when the owner says "publish", "publish it", "put this build up", "upload the release", or has already run `pnpm electron:dist` and installed the setup. For the full ceremony from `dev` — merge, bump, build, level `dev` — use the `release` skill instead.
---

# Publish a build

**`publish` is `release` without the git ceremony and, when the artifacts strictly qualify, without the build.**

The owner has already bumped the version, built the setup, and installed and tested it. This skill does everything after that: the notes, the tag, and the upload. It does **not** merge, does **not** care which branch is checked out, and does **not** touch `dev`.

The skipping is an **optimisation, not a promise**. If the existing pack does not strictly meet every requirement below, this skill builds what is needed and carries on — it never publishes something that does not match.

Sources of truth: `AGENTS.md` §9 and `docs/commands.md` §0 (the convention) and §9 (how counters take the update). The `release` skill is the sibling runbook; everything they share is written there once and pointed at from here.

## publish vs release

| | `release` | `publish` |
| --- | --- | --- |
| Starts from | `dev`, merged into `main` | **whatever commit is checked out** — branch, tag, or detached HEAD |
| Version bump | the skill does it | **the owner** did it |
| Build | the skill runs `pnpm electron:release` | **the owner** ran `pnpm electron:dist` — rebuilt here only if the pack does not qualify |
| Smoke test | none — the owner tested before saying "release" | already done, unless a rebuild happened here |
| Pushing | saying "release" is the authorisation | **asks first**, one gate, every push listed |
| `dev` levelled after | yes | no |

## Ground rules

- **Any commit.** No `main`-only rule. The tag `v<version>` lands on `HEAD`, wherever that is. On a detached HEAD no branch is pushed — `scripts/release-electron.ts` handles that and says so.
- **Never publish a pack whose version does not match `package.json`.** `verify-package.ts` check A6 enforces this; see *The strict gate* below for why it matters more than it looks.
- **A `-` in the version still makes it a test build.** `1.3.1-pre.1` goes to `GITHUB_UPDATE_REPO_2` only, marked a GitHub prerelease. No `-` goes to every repo. Automatic — never reach for `RELEASE_ONLY_REPO` to get it.
- **Ask before every push.** One gate, listing all of them. Nothing runs until the owner says yes.
- **Never** tag by hand, push a tag on its own, draft a release or upload a binary in the GitHub web UI, or reuse last version's notes.

## Step 0 — The strict gate

Read, do not assume. `dist-app/` is a graveyard: it keeps every past `AbeerSuite-Setup-*.exe` and half-finished archives from abandoned versions. **Every check is version-specific.** "A file exists" proves nothing.

```bash
node -p "require('./package.json').version" && git tag -l && git log --oneline -1 && git status --porcelain && ls -l dist-app/
```

**A `dist` build first — look for the marker.** `git tag -l "dist-v<version>"`. If it exists, the build came from the `dist` skill and the marker is the authority:

1. **Commit:** `HEAD` must be or contain the marker's commit (`git rev-parse dist-v<version>^{commit}`). If `main` has moved on, stay on it and say so: step 5 tags the marker's commit, not `HEAD`. Never tag a later commit for a dist build's installer, and skip steps 2–3 — the notes were committed by `dist`.
2. **Package:** the `sha512:` in the marker's message (`git tag -l --format='%(contents)' dist-v<version>`) must equal the top-level `sha512:` in `dist-app/latest.yml`, and the installer file it names must be present. A `latest.yml` from another version → `pnpm dist:pin` writes the right one, keeping a marker that names this installer. Any other mismatch → the pack was rebuilt or overwritten since the owner tested it; stop and say so (rung B territory — it needs a fresh `dist` and a fresh test).
3. Both match → checks 1–6 below still run, and pass as a reused pack.
4. **Delete the marker after step 5 has succeeded for every repo**: `git tag -d dist-v<version>`. Step 5 reads it, and so does a retry.

No marker → carry on as below.

The pack may be reused **only if all six pass**:

| # | Check | How |
| --- | --- | --- |
| 1 | `dist-app/win-unpacked/AbeerSuite.exe` exists | `ls` — it is what `release-electron.ts` publishes from |
| 2 | The version **inside** the pack equals `package.json` | `readPackagedVersion()` in `scripts/packagedVersion.ts` |
| 3 | That version is **not** already a tag | `git tag -l` — an existing tag means it already shipped |
| 4 | `AbeerSuite-Setup-<version>.exe`, its `.blockmap`, and a `latest.yml` naming **that** version are all present | `ls dist-app/` and read `latest.yml` |
| 5 | The pack is newer than the last source change, and the tree is clean | `git status --porcelain`, mtimes |
| 6 | `verify:package` passed for this pack | re-run it — it is cheap, and it is the gate |

**Check 2 is the one that bites.** `app.getVersion()` — and therefore everything `electron-updater` compares — reads the generated `package.json` stamped into `app.asar` at pack time, not the one in the repo. Bumping after a pack renames the installer and rewrites `latest.yml` but leaves that stamp alone. The counter then installs "1.3.8", still calls itself 1.3.7, and is offered 1.3.8 again — **an update loop on every till**, only visible after the release is public.

Also **read and report the variant** — `APP_MODE` and `LANDING_PAGE`, which `verify:package` prints from `resources/counter.env`. Do not ask the owner; the build already decided. Say it plainly in the report so a wrong-variant installer is caught before it reaches the release repos.

**Stop anything that can lock a rung-A/B rebuild first** — same reason as `release`'s Preflight: a leftover `AbeerSuite.exe` or `electron.exe` (from a smoke test or a `pnpm dev` / `pnpm electron:dev` session) holds the very files `electron-builder` needs to rename, and a dev server on port `3000`/`786` can clash with a fresh `.next` output. Run this before rung A or B, whichever the gate calls for:

```powershell
Get-NetTCPConnection -LocalPort 3000,786 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Get-Process -Name AbeerSuite, electron -ErrorAction SilentlyContinue | Stop-Process -Force
```

Say so in the report if it closed a window the owner had open.

## Step 1 — Build only what the gate demands

Cheapest rung that fixes the failure. Never more.

**Rung A — only the version stamp is wrong** (check 2 failed, source unchanged since the pack):

```bash
pnpm exec electron-builder && pnpm verify:package
```

This skips `electron:build`. `build.files` is only `dist-electron/**/*`; everything else rides in `extraResources`, already on disk. It re-stamps `app.asar` and re-makes the installer from the same inputs — **the code stays byte-identical, so the owner's test still stands.** No smoke test needed. Say that plainly rather than making them test again.

**Rung B — source changed, or the pack is missing or stale** (check 1, 5 or 6 failed):

```bash
pnpm electron:dist
```

Full build. The owner's earlier test no longer covers this binary, so **stop and ask for the smoke test**, exactly as `release` does.

**Check 3 failed — the version is already tagged.** No build fixes this; the version already shipped. Stop and tell the owner: bump `package.json`, then run rung A (which reuses everything they tested), then `/publish` again. Do not move or delete the existing tag.

## Step 2 — Write `RELEASE_NOTES.md`

**Rewritten from scratch for this version.** Not appended to, not left from last time.

```bash
git log $(git describe --tags --match "v*" --abbrev=0)..HEAD --pretty=format:"%h %s"
```

The full rules — customer-readable plain Indian English, one `##` heading per area the user notices, `# v<version>` as the first line, calling out a schema change and its publish-then-migrate ordering, and the urgency tiers — live in **`.claude/skills/release/SKILL.md` step 3**. They are identical here; read them there rather than keeping a second copy that will drift.

The short version of the part that costs the most if it is wrong: urgency is `minimumCounterVersion` in `package.json`, not a word in the notes. Raise it to this version only for what touches everyone (a migration, a common API, sync, sign-in, a serious POS bug) — it interrupts cashiers mid-sale. The script writes `[urgent]` itself.

`scripts/release-electron.ts` appends the raw commit log below what you write, so the file holds **only** the hand-written half.

**Show the drafted notes and the tier to the owner and wait.** They know which change customers care about; you only know the commits.

## Step 3 — Commit the notes

```bash
git add RELEASE_NOTES.md && git commit -m "docs(release): attempt v<version> - <one line on what this version is>"
```

Add `package.json` too if the owner's bump is still uncommitted. **Stage only those files** — never `git add -A`; the owner keeps local edits and the pack script renames files.

**Write `attempt v<version>`, not a bare `v<version>`** — the same rule as `release` step 4. The installer already exists and the owner has tested it, but this commit still lands *before* the tag and the upload (step 5), and a publish can die halfway or reach one release repo and not the other. Until the tag is on the commit, the version has not gone out, and the message must not say it did.

The tag is the proof, not the commit. `attempt v1.3.8` **with** `v1.3.8` on it is a published version; the same line with no tag is a run that stopped short. Do not reword the commit afterwards — that would need a force push to two remotes for no gain.

On a detached HEAD a commit moves HEAD but belongs to no branch. Say so, and confirm the owner wants the notes committed there rather than on a branch.

## Step 4 — The push gate

**List every push that is about to happen, then wait.** Nothing runs until the owner says yes.

On a branch:

```bash
git push origin <branch> && git push production <branch>
```

Then name the two that follow: the tag to `origin` (step 5 does it, inside the script) and the tag to `production` (step 6).

On a detached HEAD or a tag: **no branch push.** Say that plainly — only the tag goes out, to both remotes.

## Step 5 — Tag and upload

```bash
npx tsx scripts/release-electron.ts --reuse-installer
```

`--reuse-installer` checks the tested `.exe` against the marker and uploads it byte for byte, as a draft that is published once all three files are up. It needs the marker and the `gh` CLI. A build with no marker, or a rung A re-stamp, runs without it and electron-builder packs a new installer. Retry one repo with the same flag plus `RELEASE_ONLY_REPO`.

Running the script directly is correct **here and only here**: `release` forbids it because it bypasses the `verify:package` gate, and in this flow that gate has already passed — in the owner's `pnpm electron:dist`, and again at step 0 check 6. Confirm it passed before running this. If you cannot confirm it, you are on rung B, not this step.

What the script does: assembles the notes (yours, then the auto commit log since the previous tag), creates the annotated tag **`v<version>`** on `HEAD` if it does not exist, pushes it — the branch too when one is checked out, the tag alone when detached — and publishes a GitHub release to each `GITHUB_UPDATE_REPO_N` with that repo's own `GITHUB_UPDATE_REPO_N_TOKEN`, carrying the installer, the blockmap, `latest.yml` and the notes. It prints whether it is doing a full release or a prerelease before it starts. **Read that line.**

## Step 6 — Level `production` (`electron:release` already pushed the release tag there before publishing)

```bash
git push production <branch> refs/tags/v<version>
```

Detached: `git push production v<version>`.

The script pushes `origin` only. Both source remotes must carry the tag, or the two accounts disagree about what `v<version>` is.

## Step 7 — Report

Say each one plainly:

- Which commit was published, and what it is — branch, tag, or detached HEAD.
- Whether the existing pack was reused, re-stamped (rung A), or rebuilt (rung B).
- The variant: `APP_MODE`, `LANDING_PAGE`.
- What was pushed, to which remotes.
- **Every** release repo shows the installer, the blockmap, `latest.yml` and the crafted notes — or, for a `-pre` version, **repo 2 shows them and repo 1 was deliberately left alone**. Say which, and that counters will not see a test build.
- Which urgency tier went out, and therefore how counters will take it.

## Join hand — where to stop and ask

Handing a step back is not stopping the publish: do everything either side of it, then pick the list up.

| Ask for | When |
| --- | --- |
| **The notes and the tier** | Always, before step 3. |
| **Every push** | Always, step 4. This is the skill's one hard gate. |
| **The smoke test** | Only after a rung B rebuild. A rung A re-stamp does not invalidate their test — do not ask for it again. |
| **A version already tagged** | Stop. Bump and re-stamp — their call. |
| **Anything that would be a guess** | A schema release's publish-then-migrate ordering; a repo that failed to publish. |

## Stop and ask — failures

- **`verify:package` fails** → stop. The gate exists because these failures reach a counter, not the build machine. Read the named failure, fix the cause, repackage.
- **Check A6 (packaged version) fails** → rung A. Never publish past it.
- **Publish fails for one repo after another succeeded** → retry that one alone:

  ```bash
  RELEASE_ONLY_REPO=<owner/repo> npx tsx scripts/release-electron.ts
  ```

  Retry path only, **never** the normal path. Give the full `owner/repo` — both release repos are named `abeersuite-electron`.

- **A tag already exists for this version** → step 1, check 3. Report it; do not move or delete it.

## Related files

- `.claude/skills/release/SKILL.md` — the sibling runbook; the notes rules and urgency tiers live there.
- `.claude/skills/dist/SKILL.md` — makes the test build and the `dist-v<version>` marker this skill reads in step 0.
- `AGENTS.md` §9 — the release clause the owner holds you to.
- `docs/commands.md` §0 — the convention; §9 — the update tiers.
- `scripts/release-electron.ts` — tagging, the detached-HEAD branch skip, notes assembly, multi-repo publish, `RELEASE_ONLY_REPO`.
- `scripts/verify-package.ts` — the gate; check A6 is the packaged-version match.
- `scripts/packagedVersion.ts` — reads the version baked into `app.asar`.
- `package.json` — `version`, `electron:dist`, `electron:pack`, `verify:package`.
- `electron/updateManager.ts` — how a counter compares itself with the minimum and decides when to install.
