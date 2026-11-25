---
name: project-counter-number-vs-id
description: "Owner names tills by counter NUMBER (\"Counter 23\"); PROJECT_BRAIN and logs often use the PosCounter id (93) — same till."
metadata:
  type: project
  modified: 2026-09-29T07:56:34.201Z
---

The owner says "Counter 23" for the till PROJECT_BRAIN calls "Counter 93": the name is "Counter 23 rakesh", PosCounter id 93. Same pattern for the others (Counter 22 Prokash = 92, Counter 24 aka = 94). Seen 2026-09-29.

**Why:** a search for "Counter 23" in docs finds nothing; the 2026-09-27/28 outbox clean-up is filed under 93.

**How to apply:** when the owner names a counter number, search docs and past transcripts by both the number and the id (check the pos_counters list, do not assume a fixed offset). The by-hand outbox clean-up for that till is in PROJECT_BRAIN's 2026-09-27 entry. See [project_counter_install_paths_vary](project_counter_install_paths_vary.md) for finding psql on a till.
