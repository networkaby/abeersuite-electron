---
name: project-play-console-duns-pending
description: "Play Console org account on the akramuljakir Google account waits for D&B D-U-N-S (ref [masked], filed 2026-10-26); shop app rejected 2026-10-27 for rewards = financial, points hidden in app"
metadata:
  type: project
  modified: 2026-11-12T20:25:19.131Z
---

Owner chose the akramuljakir Google account to own the Google Play developer account (Organization), name "Network Service" (GST trade name; legal name Akramul Jakir, proprietorship, GSTIN [masked], Abhayapuri Assam 783384). Client apps go on each client's own Play account, AbeerSoft only invited as user.

D-U-N-S requested free at dnb.co.in on 2026-10-26, reason "Google Developer", reference [masked], contact info@networkservice.in (Cloudflare routing to gmail) / [masked]. Apple's D-U-N-S lookup was down that day.

Interim (2026-10-26): Personal Play account created on akramuljakir, developer name "Network Service", account ID [masked], payments profile "Akramul Jakir" (individual). Plan: convert to Organization in place (About you → Change account type) when D-U-N-S arrives; run the 12-tester/14-day closed test meanwhile.

**Rejection 2026-10-27:** in.networkservice.shop (app id 4976297337921391873) rejected, "Play Console Requirements" — Financial features was declared "Rewards, points, frequent flier miles…", which Google files under Payments and transfers → Organization-only. Owner chose (2026-10-28) to hide points in the app, not misdeclare: commits 5b0a9ae8 + bf0cc185, one switch `SHOP_APP_PLAY_REVIEW` in src/shared/lib/device/shopApp.ts (the undo list is written there). Owner then (same day) asked to hide everything alarming: wallet, checkout points, Bills' Ledger/Outstanding/balance/UPI, Social. Undo = set false + d_shop deploy, only after approval. Then answer "My app doesn't provide any financial features" and resubmit — only after the change is live on shop.networkservice.in. 

**Resubmitted 2026-10-28 ~14:35 IST** after d_shop 4a6a2336 went live (wallet/social redirect to Account verified on shop.networkservice.in): Financial features = none, 14 changes incl. closed testing Alpha 7 (2.2.1), category Shopping. Review up to 7 days.

**2026-11-12 16:12:** D&B emailed: request assigned to Relationship Manager [masked], will contact within 2 business days (~by 2026-11-16). General: serviceindia@dnb.com. Number not issued yet.

**2026-11-24:** D&B emailed a 5-business-day documents upload link. **2026-11-27 ~evening:** form filled and submitted (Claude in owner's Chrome) — Proprietorship, est. 2004, Retailer "computers, CCTV and accessories", sales ₹32,94,296 (FY 2024-25 ITR/GST), 5 employees; ZIP = GST certificate + driving licence (no shop electricity bill — D&B may ask for one). Thank-you page showed the same tracking number. The D&B session times out after ~20 min idle: fill and submit in one sitting.

**Why:** Play Organization signup is blocked until the 9-digit number arrives; declaring "none" while points show would be a misrepresentation risk to the whole account.
**How to apply:** when the number arrives, resume play.google.com/console/signup as akramuljakir, Organization; payment profile "Network Service2" or a new one matching D&B exactly. After conversion: set SHOP_APP_PLAY_REVIEW=false, re-declare Rewards/points in Financial features, resubmit. Its old Cloud debt was paid 2026-10-26; an expired card left in place (cannot remove while primary on closed billing accounts). Three 2020 projects shut down same day.

**2026-11-27 ~16:11 IST:** applied for production access for in.networkservice.shop (closed test Alpha, build 2.2.3 / code 9, 25 testers, 12x14 met). Google review up to 7 days, email to account owner. On approval: create a production release from 2.2.3 (points/wallet stay hidden). Staff app is NOT in this Play account yet — owner wants it test-track only (no public release).

**2026-11-27 ~16:45 IST:** NS Staff (in.networkservice.staff, Play app id 4974956405661036677, draft since 2026-10-27) — internal testing live with 6 (2.3.0), testers = email list "NS staff" (7). Build: phone-app/build-apk.ps1 now also writes android/app/build/outputs/bundle/release/app-release.aab. Next staff update: bump versionCode, build, Create new release on Internal testing. Never goes to production (owner).

**2026-11-27 evening — NS Staff app content:** store listing done (icon = public/m-icon-512.png, feature graphic labelled AI-made, 2 screenshots Home + Stock); privacy policy shop.networkservice.in/privacy, no ads, not government, no financial features, no health, no Ad ID, content rating done (Everyone; "users interact" = WhatsApp Inbox), category Business, contact support@networkservice.in + shop.networkservice.in. Data safety saved as DRAFT (name/email/user ID/phone/other financial/in-app messages/photos optional/device ID; collected, not shared, encrypted, accounts via employment, deletion URL /delete-account). Still open: **Sign in details** (owner must create a reviewer staff login and type it in Play himself) → then Target audience (18+ only) → submit Data safety → send changes for review in Publishing overview. Track stays Internal testing only.
