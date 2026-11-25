---
name: project_seed_guard_local_database_url
description: pnpm prisma db seed refuses on this workstation because .env sets LOCAL_DATABASE_URL; clear it inline to seed the local copy.
metadata: 
  type: project
  modified: 2026-09-20T00:41:50.654Z
---

> **May be outdated:** AGENTS.md section 5: `pnpm prisma db seed` no longer runs personal-bootstrap; the personal snapshot is retired.

`pnpm prisma db seed` (= `personal-bootstrap.ts`) stops with *"this looks like a shop counter PC"* here, because `.env` carries `LOCAL_DATABASE_URL=…/smx` (a dev leftover) and `assertNotCounterReplica` treats any set value as a counter. `.env.local` already says `COUNTER_PC=false`.

**Why:** the guard protects a till's replica from minted ids; on this machine the target is the local copy `abeersuite_dev` ([project_abeersuite_dev_local_copy](project_abeersuite_dev_local_copy.md)), which is exactly what should be seeded.

**How to apply:** run the seed with the variable blanked for that one command —
`LOCAL_DATABASE_URL="" COUNTER_PC=false pnpm exec tsx prisma/seeds/personal-bootstrap.ts`
(dotenv never overrides a variable that is already set, even to ""). Same trick for `seed:sync-permissions` and `seed:personal:capture` if they refuse. Never blank it while `.env.local` points at live.
