---
name: stage-only-own-files
description: "Never `git add -A` in this repo; stage the exact files you touched. The pack script and the owner's own edits leave unrelated changes in the tree."
metadata: 
  type: feedback
  modified: 2026-09-07T05:57:58.230Z
---

Stage only the files you edited, by path. Never `git add -A` or `git add .`.

**Why:** `pnpm electron:pack` temporarily renames shop/portal routes to
`*.counter-build-excluded` while it runs, and the owner keeps small local edits in the
working tree (e.g. a FinanceTopBar tweak). A blanket add swept one of those into a
feature commit and had to be split out afterwards.

**How to apply:** `git add <paths>` with the list from `git status --short` filtered to
your own files, then commit. See [user-pushes-manually](user-pushes-manually.md) for the push rule.

**`package.json` in the main checkout (seen 2026-09-07):** the working copy carries an
uncommitted `publish` / `releaseInfo` block written by the release pack, and something
outside the session rewrote the file twice during a long session, dropping an edit I had
made to the `scripts` block. Do not `git add package.json`. Stage it as a blob instead:
`git show HEAD:package.json` → apply only your change → `git hash-object -w` →
`git update-index --cacheinfo 100644,<blob>,package.json`. Verify with
`git show :package.json` before committing, and expect `pnpm precommit` (which reads the
working copy) to run the OLD scripts until the owner reconciles the file.
