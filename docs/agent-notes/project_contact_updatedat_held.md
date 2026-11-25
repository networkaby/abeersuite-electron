---
name: project_contact_updatedat_held
description: "The Phone/Email updatedAt migration is finished but parked on branch hold/contact-updated-at, to land with a counter release."
metadata: 
  type: project
  modified: 2026-09-15T23:17:40.167Z
---

> **May be outdated:** `Phone.updatedAt` and `Email.updatedAt` are in the schema now, so the parked work has landed.


On 2026-09-16 the `Phone` / `Email` `updatedAt` work was committed and then
deliberately rewound off `dev`. It lives on branch **`hold/contact-updated-at`**
(commit `53022ae9`). Land it with:

```
git cherry-pick hold/contact-updated-at && pnpm prisma generate
```

**Why it is held.** Once the schema declares the column, Prisma selects it in
every query that reads phones — Contacts, Companies, person detail, profile view,
e-commerce order detail — so they all throw `P2022 column Phone.updatedAt does not
exist` until the migration reaches the database. And it cannot reach live first:
a column the source has and a replica lacks is `missing` to `schemaGuard.compare`,
which halts **every table** on that till with exit 4. So it can only travel with a
counter release — build and install the counters, then deploy. See
[project_schema_ships_via_migrations](project_schema_ships_via_migrations.md).

**What stays broken meanwhile:** a phone **edited or deleted** in the office never
reaches a counter replica (`Phone` is still `append` on `createdAt`, and the hourly
reconcile compares append tables on keys alone). A newly **added** phone does
arrive. The browser-side half shipped on `dev` — `contactWrite.touchOwner` bumps
the owning Person/Company — so the in-browser party list is current everywhere.

Also noted: `20260914090000_counter_multiple_epbx_extensions` still reads as
pending on live despite being in tags v1.3.6/v1.3.7, so the next deploy applies
two migrations, not one.

Related: [project_party_list_whole_list_in_memory](project_party_list_whole_list_in_memory.md).
