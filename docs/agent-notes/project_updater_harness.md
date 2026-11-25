---
name: project-updater-harness
description: How to test electron/updateManager.ts without a release or the Next server — a tiny Electron harness plus a fake feed.
metadata:
  type: project
  modified: 2026-11-03T11:52:21.682Z
---

The counter updater can be exercised in about a minute without `electron:dev`: a scratch folder with its own `package.json` (`"version"` = the version to pretend to be) and a `harness.js` that serves `latest.yml` + a fake installer over http, sets `UPDATE_FEED_URL` / `UPDATE_DRY_RUN=1`, then requires `dist-electron/updateManager.js` (after `npx tsc -p electron/tsconfig.json`). Run it with the electron.exe under `node_modules/.pnpm/electron@*/node_modules/electron/dist/`. `require('electron')` prints a "Downloading" line before the path, so don't capture its output as the path.

**Why:** built 2026-11-03 to prove the minimum-version tiers (quiet / urgent / skipped / legacy `[urgent]`).

**How to apply:** read the autoUpdater flags through `require.resolve("electron-updater", { paths: [<repo>/dist-electron] })`. Requiring the repo's `node_modules/electron-updater` directly gives a second instance, and its flags look wrong. With no window open, `onSafeScreen()` is true, so an urgent update installs on the first 15 s poll. See [project_app_update_prompt](project_app_update_prompt.md).
