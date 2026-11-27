---
name: part4-publish-option-deferred
description: Part 4 cannot publish or keep problem products in Ready; owner said "not now" to adding it (2026-11-27)
type: project
---

Product-recheck (Part 4) can only leave a verified product at `same | draft | ready | waiting`, and any problem parks it in Attention (`savePart4` in `src/modules/ecommerce/lib/agentProductPrep.ts`). On 2026-11-27 the owner asked "publish if ok, otherwise keep in Ready"; it was done by hand in the counter app (Save as ready / Publish). Adding `then: "published"` and a "keep in place with problems" option was offered — owner said **not now**.

Also: until 578a12cac (2026-11-27), `stage=ready` with no `need=` came back empty (default `need=copy`). Since then any `stage=` lists every product in it.

**Why:** owner wants to decide later when the AI may publish directly.
**How to apply:** when the owner asks for publish/keep-in-Ready again, do it by hand in the app (or ask again about the code change); don't re-propose unprompted.
