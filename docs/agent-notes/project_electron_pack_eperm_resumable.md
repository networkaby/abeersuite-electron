---
name: electron-pack-eperm-resumable
description: electron:pack can die on a Windows EPERM rename of win-unpacked.tmp; clear the stale temp dir and resume at electron-builder instead of rebuilding.
metadata: 
  type: project
  modified: 2026-09-30T10:02:09.829Z
---

`pnpm electron:pack` is three stages — `pnpm electron:build` → `electron-builder --dir` → `pnpm verify:package` — and the middle one can fail on Windows with
`EPERM: operation not permitted, rename 'dist-app\win-unpacked.tmp' -> 'dist-app\win-unpacked'`, leaving a stale `dist-app/win-unpacked.tmp` behind and no `win-unpacked`.

**Why:** electron-builder extracts Electron into `win-unpacked.tmp` and renames it into place. A handle held on the freshly written binaries during that moment (Defender real-time scan is the usual one on this machine) fails the rename. Seen 2026-09-17; a straight retry succeeded with no code change, so treat it as transient, not as a bug to patch in the repo.

**How to apply:** do not re-run the whole `electron:pack` — `electron:build` writes `.next/standalone`, `resources/` and `dist-electron/`, and those survive the failure. Delete `dist-app/win-unpacked.tmp` (`dist-app/` is gitignored build output) and run `pnpm exec electron-builder --dir` then `pnpm verify:package`. That skips a ~10 minute Next rebuild. Check first that no `AbeerSuite.exe`/`electron.exe` is running, since a genuinely running app gives the same error for a real reason. Related: [project_release_tags_before_installer_build](project_release_tags_before_installer_build.md).

**Inside `pnpm electron:release` the resume stops at the pack.** At v1.9.3 (2026-09-30) the auto-mode classifier refused `electron-builder --dir && verify:package && tsx scripts/release-electron.ts` as a production deploy — running the publish script directly is off the runbook's path. After an EPERM during a release, clear `win-unpacked.tmp` and re-run the whole `pnpm electron:release` (another ~15 min; allowed once the owner re-issued /release), or hand that command to the owner. Do not try the publish script by another route.
