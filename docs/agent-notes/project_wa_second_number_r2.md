---
name: project-wa-second-number-r2
description: Second WhatsApp number 8876996996 (conversations) + chat attachments in Cloudflare R2; coexistence not approved — App Review never submitted (checked 2026-10-23)
metadata:
  type: project
  modified: 2026-10-23T08:43:21.476Z
---

> **May be outdated:** ids go in .env or the DB, not code constants (feedback_secrets_vercel_ids_db.md); the 96996 plan is in project_wa_96996_coexistence_plan.md.

2026-10-08: owner added +91 88769 96996 as a conversation-only WhatsApp number (OTP stays on 88769 96977). Wanted coexistence (keep WA Business app); Meta refused — loginapi app lacks advanced whatsapp_business_* access (needs Business verification + App Review / Tech Provider). Fallback = Cloud-only; owner to retry coexistence later.

2026-10-23 check in Chrome: Business verification = Verified (Network Service, 732965133229963). loginapi app (2392613611266946) still "In development"/Unpublished; App Review shows whatsapp_business_messaging, whatsapp_business_management, business_management, public_profile as "Not submitted". Access verification (Tech Provider) not done. 96996 display name "In review". So coexistence is NOT approved — it was never submitted. Campaigns "Status / Channel prepare & share" (plan A) depends on this for posting Status from the company number.

2026-10-23 later: Tech Provider access verification SUBMITTED (in review, ≤5 days). App settings filled (icon, category Business and pages, terms/privacy/deletion URLs, Website platform office.networkservice.in). App Review submission 2454921678369472: all 4 permissions + data handling (processors Vercel/Supabase/Cloudflare, controller Network Service, India) + reviewer instructions filled; demo video = POS bill POS-10786-26 (₹300 credit to owner's own party [masked] — owner to cancel via Return) + WA reply in CRM > Messages. SUBMITTED 2026-10-23 ~14:20 — "Review in progress", Meta says most within 20 days. After approval: publish app, then "Connect number" on Settings > WhatsApp Templates for coexistence.

Owner wants number IDs in `src/shared/lib/constants/whatsapp.ts`, not .env (only secrets in .env).

Attachments live in Cloudflare R2 bucket `abeersuite-messages` (private, account 651924adf29011fa8567c11fb681a5cf); owner chose R2 over Cloudinary/Supabase for cost. Signing is hand-rolled SigV4 in `src/shared/lib/storage/r2.ts` (no SDK, to avoid pnpm install under a running dev server). A test object `test/hello world.txt` sits in the bucket.

Owner 2026-10-08: second number waits until attachments work and speed is satisfactory — attachments first.

**Why:** cost + privacy of customer documents.
**How to apply:** before touching WhatsApp sending, check constants/whatsapp.ts for `WA_CONVERSATION_NUMBER_ID`; see [project_bill_notify_push_and_whatsapp_both](project_bill_notify_push_and_whatsapp_both.md).
