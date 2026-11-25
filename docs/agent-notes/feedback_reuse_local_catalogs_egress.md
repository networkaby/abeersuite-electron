---
name: feedback-reuse-local-catalogs-egress
description: "Before adding any search or list endpoint, reuse the Dexie catalogues already on the device; owner prioritises egress cost"
metadata:
  type: feedback
  modified: 2026-10-02T13:43:57.647Z
---

Before writing a search or list API, check what the browser already holds:
- `useProductCatalog`: the POS products in Dexie `abeer-replica`, with deltas.
- `usePartyList` / `partyCatalog`: every party, loaded on every page by `PartiesWarmup`.
- `useDayBook` views.

Search those on the device with `searchProducts` / `searchPartyRows`.

For money figures, which must be fresh, save the last answer in Dexie (the `answers` table) and re-ask with `?since=`. The server should answer `{ unchanged: true }` from a cheap probe (`booksUnchangedSince`).

**Why:** on 2026-10-02 I built the phone app's Stock and Party screens on new per-search server endpoints, with a localStorage cache. The owner asked "local db, dexie?" and then "save egress cost". That broke the standing rule that party search reads from memory ([project_party_list_whole_list_in_memory](project_party_list_whole_list_in_memory.md)), and it duplicated catalogues the device already had.

**How to apply:** grep `localDb.ts`, `useProductCatalog`, `partyCatalog` and `polling.ts` before proposing any endpoint that returns rows. Put new freshness numbers in `constants/polling.ts`, which is the egress dial.
