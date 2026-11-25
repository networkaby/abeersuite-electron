---
name: project_v_live_relay_dominates_till_latency
description: "Under v_live a till's wait is the relay hop to Vercel, not database round trips — optimise HTTP request count, not statement count."
metadata: 
  type: project
  modified: 2026-09-14T16:39:54.887Z
---

Measured 2026-09-14 from the shop's counter PC:

- Counter PC → Supabase (ap-south-1): **~68 ms per statement** (pooler and direct alike).
- `WRITE_API_URL` = `https://office.networkservice.in` → **Vercel, region `bom1`** (confirmed via `X-Vercel-Id`), the SAME AWS region as Supabase. So statements executed on the office cost single-digit ms, not 68.
- Shop → that host: **~0.42 s** for a static asset. That is the relay hop, paid per relayed request.

**Why:** it decides where performance work pays off. Cutting database round trips only helps a machine that talks to Supabase *itself* — `WRITE_MODE=live`. Under `v_live` the route runs next to the database, so statement count barely matters; the till waits on the relayed HTTPS calls.

**How to apply:** before optimising a counter-facing write, ask which `WRITE_MODE` it runs under. For `v_live`, reduce the **number of relayed API requests** (e.g. voucher create + post are two — merging them halves the wait). For `live`, reduce **statements inside the transaction**. See `project_voucher_save_roundtrip_work`.
