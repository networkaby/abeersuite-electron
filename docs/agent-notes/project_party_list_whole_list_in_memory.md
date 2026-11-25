---
name: project_party_list_whole_list_in_memory
description: Party search reads the whole customer list from memory on every machine — no per-keystroke endpoint exists any more.
metadata: 
  type: project
  modified: 2026-09-15T23:17:46.941Z
---

Since 2026-09-16 (commit `385a7041`) every party picker searches the **whole**
customer list held in memory, on the web and at a counter alike.
`src/shared/lib/parties/partyCatalog.ts` owns it: its **own** Dexie database
(`abeer-parties`, deliberately not `browser/localDb`, which discards itself on a
replica-served till), filled from `GET /api/parties/catalog?sync=1&since=…` —
live on the web, the machine's own replica at a till. ~3,500 parties.

**There is no typeahead endpoint any more.** `/api/person?lookup=` and its
`phone` / `group` / `wide` / `full` params are gone, along with the grown cache
and `/api/parties/changed`. Do not reintroduce a per-keystroke party query.

**The rule behind it:** ranking is honest only over a complete pool. Both
previous designs ranked something smaller and hid real customers — the browser
padded a failed search with letter-pair guesses and then treated its own eight
rows as a full page, and the server cut to the eight *newest* SQL matches before
ranking. The looser tiers (typo, run-together split, closeness guesses) are
meaningful now precisely because the pool is everything.

The list only stays current because `contactWrite.touchOwner` bumps the owning
Person/Company on every phone/email write — the delta asks about
`Person.updatedAt`, and a **deleted** phone can be reported no other way.

Related: [project_contact_updatedat_held](project_contact_updatedat_held.md), [project_local_mode_sync_engine_owns_realtime](project_local_mode_sync_engine_owns_realtime.md).
