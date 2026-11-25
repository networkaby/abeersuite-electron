---
name: project-wa-96996-coexistence-plan
description: "8876996996 is on Cloud API; owner wants it in the WA Business app too — wait for business_management approval, then remove from API → app → coexistence connect"
metadata:
  type: project
  modified: 2026-11-12T23:21:26.597Z
---

2026-10-23: Meta review approved whatsapp_business_messaging/management + public_profile; rejected business_management (screencast did not show the end-to-end flow). That permission is used only by the Settings → WhatsApp Templates "Connect a WhatsApp Business app number" button (Embedded Signup coexistence).

8876996996 is already on the Cloud API. Coexistence only goes app → API, so the owner agreed: get approval first (video: connect 8876996988 on the WA Business app, "Hi" sent from [masked]; [masked] skipped as it holds personal chats), and only then remove 96996 from the API, register it in the Business app, and connect it back via the button.

**Why:** 96996 can only come back via the Connect button, which needs approval. CORRECTION 2026-10-24: OTP, bills and all replies go from the MAIN number 8876996977 (META_WA_PHONE_NUMBER_ID 1187835644417116); 96996 (id 1412417001952698) is CONNECTED on Cloud API but unused (WA_CONVERSATION_NUMBER_ID null), so removing it causes no shop downtime.
**How to apply:** never suggest removing 96996 from the API before approval. Supersedes the 96996 note in [project_wa_second_number_r2](project_wa_second_number_r2.md).

2026-10-23 night: business_management resubmitted (submission 2472573343270972, "Review in progress") with captioned screencast D:\Users\User\Videos\Media4-captioned.mp4 (connects 8876996988 into the AbeerSoft portfolio). The owner business (Network Service) cannot be picked in Embedded Signup, so moving 96996 needs a non-owner portfolio or WhatsApp Manager's own route. office.networkservice.in added to Facebook Login for Business JS SDK allowed domains the same day.

2026-10-24: owner wants a fallback — if the coexistence number disconnects, templates (bills/reminders) auto-resend from 96977; free-text replies cannot (24h window is per number) → show staff a notice/template; office alert to reconnect. Build with the post-approval coexistence work (save token + number, Disconnect button).

2026-11-12: Embedded Signup can't pick Network Service (it owns the Meta app); only AbeerSoft. Test number 88769 96988 sits in the AbeerSoft WABA (2325886324463026, phone id 685473957978610) — owner said keep it. 88769 96977 in Network Service WABA is the OTP/cloud-only number, never delete. Coexistence numbers have no delete in WhatsApp Manager — disconnect from the phone app. Counter's Connect button opens office site (261be06cb).
Owner's roles (2026-11-12): 96988 = AbeerSoft's own number (keep); 96977 = Network Service fallback, cloud-only; 96996 = Network Service main, app + cloud (coexistence) — needs Meta app moved to AbeerSoft so Network Service is pickable.
2026-11-12 later: interim = 96996 back on cloud API only in Network Service WABA, new id 1426171653917236, code-verified, profile text saved, display name in review. Owner said YES: when approved → register (PIN), upload logo, set WA_CONVERSATION_NUMBER_ID = "1426171653917236" in src/shared/lib/constants/whatsapp.ts. Coexistence waits for app move to AbeerSoft.
2026-11-13: owner's new route — app can't move to AbeerSoft (unverified, no documents), so create a SECOND "Network Service" business portfolio as the Embedded Signup client and coexist 96996 there; Page/IG stay in the first portfolio and get linked from the phone app. Not started yet. Meta Business state that day: Network Service portfolio has only two staff as full admins; 96988 has ₹40 prepaid, 0 templates; 96996 Page+IG linked, 96977 Page linked, logo on both.
