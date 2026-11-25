---
name: feedback-constants-one-home-curated
description: New tunable settings go in src/shared/lib/constants/ by topic; one-file lists stay beside their code
metadata:
  type: feedback
  modified: 2026-09-26T00:17:23.852Z
---

Owner (2026-09-26): "i want all constant together so i find easily" — then narrowed it: "all that you think necessary to have own home, not all that i will almost never touch".

**Why:** they look settings up by topic (e.g. "where is the inactivity logout?") and should not need to know which logic file holds the number.

**How to apply:** a new timeout, limit, default or nav list goes in `src/shared/lib/constants/<topic>.ts` (session, hr, polling, paging, inventory, accounting, nav, quickActions, badges…) with a line added to the map at the top of `constants/index.ts`. A list only one file uses stays beside that file. Numbers that stored data depends on (counter id `BLOCK_SIZE`, `SECRET_BUCKET_DAYS`, nav surface keys) stay with their code so nobody edits them casually.
