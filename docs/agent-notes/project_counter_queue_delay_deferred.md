---
name: counter-queue-delay-deferred
description: A live counter's queued app push / email waits for the 30-min 08:00-20:00 cron; owner said no problem for now
type: project
---

Since 98d27f07e (2026-11-26) a `WRITE_MODE=live` counter sends WhatsApp itself but leaves the app push and the email "queued" in Supabase; `counterQueue.ts` in `/api/cron/communications` sends them. That cron rings every 30 min, 08:00-20:00 IST, so a bill's push / email can arrive up to 30 min late, and an evening bill's next morning (rows count for 24 h). Proposed fix: the counter pings the office (`/api/counter/notify` "queue" job) right after its WhatsApp, cron as backup, and 2 h max age with `expired`. Owner, 2026-11-26: "no problem for now".

Also open, same area: a row taken (queued -> pending) by an office run that stops before the send stays "pending" for good.

**Why:** owner deferred; WhatsApp (the main message) still goes at once.
**How to apply:** do not re-propose unless the owner reports late pushes / emails; the plan above is ready if asked.
