---
name: project_local_mode_sync_engine_owns_realtime
description: "In local read mode the sync engine owns the Supabase realtime message; screens may act only on the replica's own \"rows applied\" signal."
metadata: 
  type: project
  modified: 2026-09-07T20:28:39.743Z
---

Owner's rule, stated 2026-09-07 while fixing the Help Desk staleness bug: on the web the
screen is the primary owner of the Supabase realtime message. On a counter reading its own
replica the **sync engine** owns that message, and the screen is secondary — it may act only
on the replica's own "collect now" (`sync:applied`), never on the Supabase nudge.

**Why:** a screen that reacts to the Supabase message reads the replica seconds before the
sync worker has written the row. It shows old data, and worse, any "changed since" stamp it
takes then sits past the row's real `updatedAt`, hiding that row for good.

**How to apply:** on a replica-served machine, no client-side delta stamps and no early
reads. `parseSince()` returns null there so routes answer in full; `subscribeRealtimeTopics`
waits for `sync:applied`; a board's own save waits too, and pins the row the server answered
with so a lagging read cannot show an older copy. See [feedback_wait_for_parallel_session_fix](feedback_wait_for_parallel_session_fix.md)
for the parallel-session etiquette that applies when this area is being edited elsewhere.
