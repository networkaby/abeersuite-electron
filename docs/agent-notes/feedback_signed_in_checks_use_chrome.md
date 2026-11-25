---
name: feedback_signed_in_checks_use_chrome
description: "Signed-in localhost checks: Chrome reaches localhost again (2026-10-01); the in-app pane signs in once but goes hidden and refuses navigation on long sessions"
metadata:
  type: feedback
  modified: 2026-09-30T01:50:32.951Z
---

For browser verification that needs a staff sign-in at localhost:3000, the owner's answer (2026-09-29) was "use Chrome" — they are signed in there, and I can't type their live password. The in-app Browser pane is not signed in.

**2026-09-30 — Chrome could not reach localhost at all.** Every Claude-in-Chrome navigation to `http://localhost:3000` (and `127.0.0.1:3000`) bounced back to `chrome://newtab` and the dev server never saw the request, even after the owner allowed the site and said "fixed chrome". Outside sites loaded fine. The LAN address `192.168.31.192:3000` loaded but was not signed in, and Next dev blocks its own dev resources for that origin (`allowedDevOrigins`), so screens do not hydrate there. The owner's answer was "do the best".

**What worked instead:** the in-app pane loads localhost fine, and its hooks run even while hidden. A temporary `src/app/shop-esc-test/page.tsx` (public because the path starts with `/shop`, outside the shop layout) built from the real components, driven with `computer` key presses plus `javascript_tool` reads of a `window.__log`, then deleted and never committed. That proves a mechanism with no sign-in and no live-data writes. The real signed-in screens then go to the owner as a short checklist.

**2026-10-01 — Chrome reaches localhost again, signed in.** It opened `localhost:3000/vouchers/sales/new?voucherId=…` straight away and read the form. The owner also signed in once in the in-app pane, which then served Year Ending, the receipt (via `fetch()` HTML) and the POS edit screen — but it went hidden repeatedly, and once hidden, `navigate` returned "denied or failed" until the tab or pane was reopened. Prefer Chrome for signed-in screens; use the pane for `fetch()` probes. A receipt page took ~25 s server-side and froze the pane tab — fetch its HTML instead of opening it.

**The live site works in Chrome** (office.networkservice.in, already signed in). After a `d_office` deploy, the office screens were driven there with read-only steps on 2026-09-30.

**Keep the Chrome window in front.** A covered or minimized Chrome window reports `document.visibilityState === "hidden"`, and React effects starve. That produced a false failure: a freshly opened dialog had no Radix Esc listener yet, so the page's Esc went back. Screenshots also time out and key presses stop arriving. Check `visibilityState` first. If it says hidden, ask the owner to bring Chrome to the front, then reload.

**How to apply:**
- Try Chrome first (`tabs_context_mcp` → navigate → confirm the server log shows the request). If it bounces, stop after 2–3 tries and don't loop.
- Open print pages and APIs directly in a new Chrome tab (e.g. /receipt/voucher/gl/<id>?paper=A4&autoprint=0).
- Don't load /office first in Chrome: its renderer froze and crashed the tab twice.
- Probe APIs with `curl` from the shell for unauthenticated checks (401 / 405 answers). Probe data with fetch() from a light page, per [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md).
