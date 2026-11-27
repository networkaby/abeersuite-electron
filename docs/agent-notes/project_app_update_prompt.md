---
name: project-app-update-prompt
description: Update bar = UA version vs appVersions.ts; since 2026-11-27 staff app is Play-only, customer app follows when SHOP_APP_ON_PLAY flips
metadata:
  type: project
---

Built 2026-10-17 (owner: no Play Store, users install/update themselves). Shell UA = `NSStaffApp/<code>` / `NSShopApp/<code>`; bare tag = code 2. `scripts/stamp-app-version.ps1` (run by each build-apk.ps1) writes UA + `src/shared/lib/constants/appVersions.ts`; `urgent` is set by hand.

**Why:** sideloaded APKs never auto-update; only native-shell changes need a new APK.

**How to apply:** bump versionCode, build, deploy — the bar appears. Download link must point at the other site host (Capacitor WebView can't download; off-host opens Chrome). Related: [project_customer_app_twa_push](project_customer_app_twa_push.md).

**2026-11-27 (owner): Google Play only.** Staff app: no website APK, no NsUpdatePlugin, no REQUEST_INSTALL_PACKAGES; every build marks " PlayStore" in the UA; the bar opens the Play listing, and an old sideloaded copy is told to uninstall + install from Play (Play's signing key differs, so Play cannot update over it). Customer app: same behaviour behind `SHOP_APP_ON_PLAY` — flip it on production approval, then make shop-app-native/build-apk.ps1 build the play bundle only and delete public/ns-shop.apk. Never reintroduce a self-installing updater in a Play build.
