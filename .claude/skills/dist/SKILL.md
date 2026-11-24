---
name: dist
description: Build an AbeerSuite setup .exe for the owner to install and test, with nothing sent to GitHub — merge dev into main, bump the version, write RELEASE_NOTES.md, commit locally, run `pnpm electron:dist`, and pin the tested build with a local `dist-v<version>` marker tag so `publish` can later upload that exact commit and package without a rebuild. Use when the owner says "dist", "make a test exe", "build the setup to test", "build but don't release", or runs /dist. For a build that goes straight out, use `release`; to upload a dist build after testing, use `publish`.
---

# Dist — a test build, release-ready but not released

**`dist` is `release` stopped before anything leaves this machine.** It prepares the version exactly as a release would — the bump, the notes, the urgency tier, the `attempt` commit — then builds the installer and hands it to the owner to test. **No push, no `v<version>` tag, no GitHub release.**

If the owner is happy, they say **"publish"** and the `publish` skill uploads *this* build — same commit, same installer — without building again. If not, the build is simply dropped or replaced.

Sources of truth: `AGENTS.md` §9 and `docs/commands.md` §0 / §9. The `release` skill holds the shared rules (notes, urgency tiers, the lock-clearing block); this file points there rather than copying them.

## Ground rules

- **Nothing goes to GitHub.** No `git push` of any branch or tag. Not to `origin`, not to `production`.
- **Never create `v<version>`.** That tag means "shipped": `release` and `publish` stop on it, and `scripts/release-electron.ts` would treat it as the real release tag. The only tag `dist` makes is the local marker `dist-v<version>`.
- **The marker is never pushed.** `release-electron.ts` pushes only `v<version>`, so the marker stays local; `publish` deletes it once used. `release` ignores it entirely.
- **`main` only**, like `release`. The marker pins the commit, so `main` may move on afterwards without harm.
- **A `-` in the version still decides the channel** — but only at publish time. `dist` itself publishes nothing.

## Preflight

Same as `release` Preflight: clean tree, `.env` present, **ask the owner to confirm `APP_MODE` / `LANDING_PAGE`**. After step 2, run the lock-clearing PowerShell block from `release` Preflight (stops `AbeerSuite.exe` / `electron.exe` / ports 3000 + 786, clears `win-unpacked*` and this version's installer). It must print `dist-app clear` before the build starts.

## The steps

### 1. Get on `main`

```bash
git checkout main && git merge --ff-only dev
```

Not fast-forwardable → stop and report. Never force.

### 2. Bump `version` in `package.json`

As `release` step 2. The version must **not** already be a `v*` tag (`git tag -l v<version>`) — if it is, it already shipped; pick the next one.

Re-running `dist` for the **same** untagged version (a fix after a failed test) is allowed: no bump, the marker moves in step 6.

### 3. Write `RELEASE_NOTES.md` and decide `minimumCounterVersion`

Exactly `release` step 3 — rewritten from scratch, customer-readable, `# v<version>` first line, schema change called out, urgency via `minimumCounterVersion`. **Show the notes and the tier to the owner and wait**, together with the variant question.

### 4. Commit locally

```bash
git add package.json RELEASE_NOTES.md && git commit -m "chore(release): attempt v<version> - <one line>"
```

Stage only these two files. **Do not push.** A clean tree here is what lets `publish` reuse the pack (its check 5).

### 5. Build

```bash
pnpm electron:dist
```

Runs `electron:build` + `electron-builder` (installer, blockmap) + the **`verify:package` gate**. A gate failure → stop, fix the cause, rebuild. Never mark a build that failed the gate.

`latest.yml` is **not** made here: electron-builder writes none without a publish config. Step 6 makes it.

### 6. Pin the build — the `dist-v<version>` marker

```bash
pnpm dist:pin
```

`scripts/dist-pin.ts` hashes the installer itself, writes `dist-app/latest.yml` from it, and puts the annotated local marker on `HEAD` with the hash and the variant (`APP_MODE`, `LANDING_PAGE`, `READ_MODE`, `WRITE_MODE`). It refuses on a version mismatch, a dirty tree, a `HEAD` newer than the pack, or an existing `v<version>` tag — fix the cause, never tag by hand. A rebuild of the same version moves the marker.

### 7. Report and stop

- Path to the installer: `dist-app/AbeerSuite-Setup-<version>.exe` (send it with `SendUserFile` only if the owner asks — it is large).
- Version, commit hash, the marker, the variant, the urgency tier chosen.
- **Nothing was pushed or published**; `main` is ahead of both remotes by the `attempt` commit.
- Next: install and test. Happy → say **"publish"**. Not happy → fix, then `dist` again (same version is fine — no `v` tag exists).

If the build is dropped for good: `git tag -d dist-v<version>`. The local `attempt` commit can stay — it will go out with the next push and the next release bumps past it.

## Join hand

| Ask for | When |
| --- | --- |
| The variant | Preflight, always. |
| The notes and the minimum | Before step 4, always — once, with the variant. |
| Anything that would be a guess | A non-obvious version bump. |

Stop and ask on a non-fast-forward merge or a failing `verify:package`.

## Related files

- `.claude/skills/release/SKILL.md` — notes rules, urgency tiers, lock-clearing block.
- `.claude/skills/publish/SKILL.md` — uploads a dist build; reads and deletes the marker.
- `scripts/release-electron.ts` — pushes only the release tag, never `--tags`.
- `scripts/verify-package.ts` — the gate.
