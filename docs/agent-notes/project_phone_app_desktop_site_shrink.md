---
name: project_phone_app_desktop_site_shrink
description: "Staff phone app looking tiny/zoomed-out on a phone = Chrome \"Desktop site\" on, not a layout bug"
metadata:
  type: project
  modified: 2026-10-03T09:55:41.915Z
---

If the staff phone app (`/m-staff-app`) looks tiny and zoomed out, as if drawn at about 980px wide, the cause is Chrome's per-site **Desktop site** switch on the office origin. The owner confirmed this on 2026-10-03 for the live URL. The phone app shares that origin with the office site, so an admin who turns Desktop site on to reach the full office also shrinks the app, installed or not. Pages cannot override it: Chrome ignores the viewport meta in that mode.

**Why:** it cost a round of "UI doesn't fit the phone" work before the real cause showed up. The fit and app-feel polish still landed on main (deeb4c6b).

**How to apply:** when a phone screenshot looks shrunk, ask whether Desktop site is on before touching layout code. [project_mobile_app_outside_counter_rule](project_mobile_app_outside_counter_rule.md)
