---
name: project-gbp-api-application
description: Google Business Profile API access APPROVED 2026-10-27 for project 975956928914 (case 7-9483000041276); 300 QPM default quota
metadata:
  type: project
  modified: 2026-10-27T20:43:33.447Z
---

GBP API allowlist approved 2026-10-27 (case 7-9483000041276, Cloud project number 975956928914, abeersuite-4f676). Default quota 300 QPM.

**Why:** campaigns can post to Google Business Profile (38cb0c9f) only once the API is allowlisted.
**How to apply:** do not re-apply. 2026-10-28: all three APIs enabled (v4 mybusiness.googleapis.com only via /flows/enableapi link — hidden from Library); OAuth web client "AbeerSuite Google Business Profile" created (redirects: office + localhost:3000); keys in .env.local only, plus GOOGLE_BUSINESS_REDIRECT_URL=localhost there (never on Vercel). First test post sent from localhost/abeersuite_dev OK. Live still needs: release (6 pending migrations), Vercel keys, d_office push, reconnect on office. No public statement implying Google partnership.
