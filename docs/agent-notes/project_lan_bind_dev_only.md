---
name: project-lan-bind-dev-only
description: LAN bind (0.0.0.0) on the Electron desktop server is intentional for now; owner will restrict it before a production build.
metadata: 
  type: project
  modified: 2026-08-24T16:09:38.903Z
---

The Electron counter server binds to `0.0.0.0` (see `electron/serverManager.ts`), reopening a network-layer exposure that a prior session deliberately closed by binding to `127.0.0.1`. This was done on 2026-08-24 at the owner's request so staff can open a counter from another PC's browser on the shop LAN, using the per-counter port (`3000 + COUNTER_EPBX_EXT`).

**Why:** owner explicitly acknowledged the tradeoff and said "we will take care of it on production build" — this is accepted as a temporary, dev/trial-phase state, not a final decision.

**How to apply:** when work turns toward hardening for a real production/live release (as opposed to internal trial), flag that the LAN bind in `serverManager.ts` needs revisiting — e.g. restrict to loopback again, add network-layer auth, or scope to a specific LAN interface — rather than assuming the current `0.0.0.0` bind is the intended end state. Don't re-raise this as a fresh vulnerability finding; the owner already knows and has deferred it on purpose.
