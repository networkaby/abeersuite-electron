---
name: project_bill_notify_push_and_whatsapp_both
description: Bill/receipt notification sends BOTH app push and WhatsApp for now; skip-WhatsApp-on-shown is deferred until behaviour is observed
metadata:
  type: project
  modified: 2026-10-06T10:21:37.037Z
---

Owner decided 2026-10-06: on a new sale/receipt, send the customer-app push AND WhatsApp, both, every time. Do not skip WhatsApp when the push is "shown" — not yet.

**Why:** owner wants to observe real push behaviour (shown rate, delay, removed apps, sleeping phones) before trusting push alone to save WhatsApp cost.

**How to apply:** build the tracking anyway (PushMessage sent→shownAt delay, per-bill App/WhatsApp status, per-party "not responding" after misses) so the decision can be made from data later. Keep the skip-on-shown logic behind a single switch, default off; no fallback timer/cron is needed while both are sent. Do not re-propose turning off WhatsApp until the owner reviews the observed numbers. Note: no bill WhatsApp sender exists yet — only OTP (sendWhatsApp.ts); a Meta Utility template is needed.
