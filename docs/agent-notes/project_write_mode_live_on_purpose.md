---
name: write-mode-live-on-purpose
description: From v1.17.16 (2026-11-25) some counter builds are WRITE_MODE=live + READ_MODE=local on purpose (testing / emergency), not v_live
metadata:
  type: project
---
Owner, 2026-11-25: keep WRITE_MODE=live in .env for testing and emergency, for some builds. v_live stays the usual mode.
**Why:** live + replica reads exposes read-after-write faults v_live hides (create customer: "Could not create", fixed 3b3e44009).
**How to apply:** on a counter bug check the baked mode (resources/counter.env) first; do not change .env back unasked. A read that answers a save uses `prismaWhereSaved()`. See [project_v_live_relay_dominates_till_latency](project_v_live_relay_dominates_till_latency.md).
