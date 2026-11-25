---
name: project-shop-app-google-signin-fingerprint
description: "Shop app Google sign-in needs signing SHA-1 in Firebase; added for ns-shop.keystore 2026-10-28, Play key still missing"
metadata:
  type: project
  modified: 2026-10-28T12:41:11.496Z
---

Shop app (Capacitor, NsGooglePlugin) Google sign-in showed "Google sign-in was cancelled." because Firebase project abeersuite-4f676's Android app in.networkservice.shop had no SHA fingerprints — Credential Manager reports that as a cancel. Added SHA-1 10:2C:C0:09:1B:43:A2:9D:7F:27:CA:82:93:58:51:90:E7:92:3C:70 (+ SHA-256) for ns-shop.keystore on 2026-10-28; owner confirmed it works.

**Why:** misleading "cancelled" message cost a long debug.
Play installs failed the same way; added Play app-signing SHA-1s too (current 4C:DA:F6…F9:39, SHA-256 F6:50:30…; previous 27-Oct key 8F:27:40…37:7A) on 2026-10-28. assetlinks.json's 49:36:EA… SHA-256 matches neither Play key — unexplained.

**How to apply:** if Play "Change key" is used again, add the new SHA-1 in Firebase. Same check for the staff app if it gets Google sign-in. ([project_play_console_duns_pending](project_play_console_duns_pending.md))
