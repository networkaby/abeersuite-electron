---
name: project_release_means_full_checklist
description: "Do a release" is one instruction for the whole checklist in AGENTS.md §8 — the agent carries it out, not a script.
metadata:
  type: feedback
---

> **May be outdated:** the checklist is now AGENTS.md section 9, and there is no smoke-test pause.

When the owner says "do a release" / "publish" / "ship a version" in `abeersuite-electron`, that is a single instruction covering the entire list in `AGENTS.md` §8 (detail in `docs/commands.md` §0): merge `dev` into `main`, bump `version`, **write `RELEASE_NOTES.md` from the real commits**, commit, push `main` to `origin` **and** `production`, run `pnpm electron:release`, push the tag to `production`, bring `dev` level again.

**Why:** the owner said plainly that the agent should take care of it — "not a script or command". Automating it into `release-electron.ts` was offered and declined.

**How to apply:** never stop after `pnpm electron:release` and hand back the remaining git steps. Release is the one exception to [user-pushes-manually](user-pushes-manually.md) — steps 5, 7 and 8 are pushes the owner has already asked for by saying "release"; everything else in this repo still stops at the commit.

The owner is happy to **join hand** mid-release: ask them to approve the drafted release notes, to smoke-test `dist-app/win-unpacked/AbeerSuite.exe`, to confirm `.env.counter`, or to run a push themselves. Handing one step back is not stopping the release — do everything either side of it and carry on.
