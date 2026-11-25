---
name: project_ui_realtime_heartbeat
description: Since 2026-09-19 every screen follows change topics and has a 5-minute heartbeat floor; editors subscribe for reference data only.
metadata: 
  type: project
  modified: 2026-09-19T17:21:32.316Z
---

The owner asked on 2026-09-19 for **every** page and screen to pick up changes — the old "editors, Settings, Admin, BI and Pricing-strategy do not subscribe" policy is withdrawn.

What now holds:
- `createSettledReader` re-reads every `HEARTBEAT_MS` (5 min, ±20% jitter) on a visible window, so no screen is stale longer than that even if the signal never arrives.
- `useRealtimeTopics` takes `settleMs` (read through a **ref**, never a dependency — adding it to the dep array changed the array's arity and broke every subscriber on a page that mixed old and new module versions). The 20 BI reports share one subscription in `useBiQuery` at 30 s.
- An editor subscribes for its **reference lists** and never for its input. Where one load fills both, `enabled` is held false while the form is dirty (Role Matrix, Year Ending, Org Defaults, Credit Limit, Offline Policies, Coupon card).

**Why:** the reported bug was a UPI row added to a counter staying invisible at the till — the signal was being published all along, nobody was listening.

**How to apply:** new long-lived screen → subscribe it; new editor → subscribe only the lists it offers. Do not re-propose the old exclusions. See [project_local_mode_sync_engine_owns_realtime](project_local_mode_sync_engine_owns_realtime.md).
