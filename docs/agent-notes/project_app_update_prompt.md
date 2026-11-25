---
name: project-app-update-prompt
description: Sideloaded staff/customer APKs learn of updates via user-agent version vs appVersions.ts; APK link must be on the other host
metadata:
  type: project
---

Built 2026-10-17 (owner: no Play Store, users install/update themselves). Shell UA = `NSStaffApp/<code>` / `NSShopApp/<code>`; bare tag = code 2. `scripts/stamp-app-version.ps1` (run by each build-apk.ps1) writes UA + `src/shared/lib/constants/appVersions.ts`; `urgent` is set by hand.

**Why:** sideloaded APKs never auto-update; only native-shell changes need a new APK.

**How to apply:** bump versionCode, build, deploy — the bar appears. Download link must point at the other site host (Capacitor WebView can't download; off-host opens Chrome). Related: [project_customer_app_twa_push](project_customer_app_twa_push.md).
