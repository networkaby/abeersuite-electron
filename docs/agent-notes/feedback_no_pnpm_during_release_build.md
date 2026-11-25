---
name: no-pnpm-during-release-build
description: "Never start any `pnpm <script>` while electron:release/pack or `next dev` runs, and never wrap a pnpm script in `timeout` — pnpm 11's pre-run install relinks node_modules; it broke a release build and hung a dev server"
metadata:
  type: feedback
  modified: 2026-09-30T01:43:36.365Z
---

Every `pnpm <script>` in this repo first runs pnpm 11's pre-run install (the `allowBuilds` block in pnpm-workspace.yaml exists because of it). On 2026-09-30 during the v1.9.2 release I ran `timeout 90 pnpm db:migrate:status` while `pnpm electron:release` was building. The status call's install relinked ~400 packages under the running build (`Cannot find module 'next/dist/bin/next'`), and the `timeout` killed that install midway, leaving packages half-copied (es-toolkit/compat held only files from "toPairsIn" on; recharts failed in `next build`). `pnpm install --offline --force` still said "Already up to date" and fixed nothing.

**Why:** the damage is invisible to pnpm and only surfaces as module-not-found deep in the Next build, costing two failed release runs.

**How to apply:** run `db:migrate:status` (or any pnpm script) before or after the build, never alongside; never put `timeout` around a pnpm script — use the tool's own timeout / background instead. If node_modules is suspect, move it outside the repo (a renamed copy inside is not gitignored) and run `pnpm install --frozen-lockfile --offline` fresh — ~1.5 min, store already has everything. `node_modules/electron/dist` being absent is normal here; electron-builder packs from its own cache. Related: [project_electron_pack_eperm_resumable](project_electron_pack_eperm_resumable.md), [project_release_means_full_checklist](project_release_means_full_checklist.md).

**Same under a running `next dev` (2026-10-05):** the shared :3000 server hung — static files 200, every proxied page/API waited forever, 0% CPU — right after its log showed Next's own `node_modules/.pnpm/next@…/client/*.js` "changed" (a pnpm run in another session). Only a restart fixed it. Run repo scripts as `npx tsx scripts/<x>.ts` / `npx tsx prisma/seeds/<x>.ts` (no pre-run install) while a dev server is up; diagnose a hang by `curl --max-time 15` on `/favicon.ico` (fine) vs `/api/auth/session` (hangs) and the last lines of `.next/dev/logs/next-development.log`.
