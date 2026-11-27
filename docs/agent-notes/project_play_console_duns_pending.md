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

**Why:** Play Organization signup is blocked until the 9-digit number arrives; declaring "none" while points show would be a misrepresentation risk to the whole account.
**How to apply:** when the number arrives, resume play.google.com/console/signup as akramuljakir, Organization; payment profile "Network Service2" or a new one matching D&B exactly. After conversion: set SHOP_APP_PLAY_REVIEW=false, re-declare Rewards/points in Financial features, resubmit. Its old Cloud debt was paid 2026-10-26; an expired card left in place (cannot remove while primary on closed billing accounts). Three 2020 projects shut down same day.

**2026-11-27 ~16:11 IST:** applied for production access for in.networkservice.shop (closed test Alpha, build 2.2.3 / code 9, 25 testers, 12x14 met). Google review up to 7 days, email to account owner. On approval: create a production release from 2.2.3 (points/wallet stay hidden). Staff app is NOT in this Play account yet — owner wants it test-track only (no public release).
