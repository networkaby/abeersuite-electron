---
name: project_fresh_worktree_precommit_setup
description: "A fresh worktree needs pnpm install, .env copied in, `prisma generate` and a pnpm deps-check bypass before anything will run."
metadata: 
  type: project
  modified: 2026-09-15T19:04:34.631Z
---

A newly created worktree fails several times for environment reasons before it ever reaches the real gates:

1. It has **no `node_modules`** — run `pnpm install` first (a few minutes).
2. It has **no `.env` / `.env.local`**: both are gitignored, so scripts die with `ECONNREFUSED` and dotenvx reports "injected env (0)". Copy them from the main checkout.
3. pnpm's pre-run dependency check aborts with `ERR_PNPM_IGNORED_BUILDS` (sharp, protobufjs, unrs-resolver, @firebase/util). Bypass with `pnpm --config.verify-deps-before-run=false <script>`, or just call the binary directly: `./node_modules/.bin/tsx`, `./node_modules/.bin/prisma`, `./node_modules/.bin/eslint`.
4. `check-counter-mode` then dies on `Cannot find module '@/generated/prisma/client'` — no generated client. Fix with `./node_modules/.bin/prisma generate` once.
5. `tsc --noEmit` runs out of heap — but that is **not** a worktree thing, it happens on main
   too. See [project_tsc_needs_bigger_heap](project_tsc_needs_bigger_heap.md).

**Why:** none of these failures has anything to do with the change under test, and #4's stack trace points into `prismaClient.ts`, which reads like a real code fault.

**How to apply:** do the install, the `.env` copy and `prisma generate` up front in any fresh worktree, rather than debugging the change. The install also edits `pnpm-workspace.yaml` (adding literal `set this to true or false` placeholders) — never stage that, per [feedback_stage_only_own_files](feedback_stage_only_own_files.md). See also [project_worktree_cannot_be_browser_verified](project_worktree_cannot_be_browser_verified.md).
