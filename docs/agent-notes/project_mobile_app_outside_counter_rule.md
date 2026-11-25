---
name: project-mobile-app-outside-counter-rule
description: "Phone app sign-in: \"Can login outside counter\" (full) or \"Can use Mobile App\" (phone-only session, since 2026-10-05)"
metadata:
  type: project
  modified: 2026-10-05T11:24:58.149Z
---

Since 2026-10-05 (commit 449d857d on dev) there are two ways into the staff phone app off a counter:
- "Can login outside counter": a full session, the phone app and the office website.
- `mobile:app:access` "Can use Mobile App": a phone-only session. The owner wants it for staff "who i want can access mobile but not web". The token carries `phoneOnly`, and proxy.ts boxes it into /m-staff-app. The API allow-list is `PHONE_ONLY_APIS` in src/shared/lib/auth/phoneOnly.ts.

**Why:** the owner's 2026-10-02 "Option 1" (outside-counter only) was the interim rule. This narrow permission is the one they said would come later, and it has to stay boxed in.

**How to apply:** a new phone-app API must live under /api/mobile or be added to PHONE_ONLY_APIS, or phone-only users get a 403. Never widen that list to office APIs casually. Live needs the permission row (`seed:sync-permissions --apply --no-revoke`) after the d_office deploy.
