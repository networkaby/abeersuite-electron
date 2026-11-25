---
name: project-unique-clash-fix-unreleased
description: Sync-engine unique-clash fix (c02cf8440) is on main but unreleased; counters show old product groups until it ships
metadata:
  type: project
  modified: 2026-11-06T01:06:27.617Z
---

> **May be outdated:** the fix shipped in v1.16.26.

On 2026-11-06 the product groups were regrouped on live into 6 departments (CCTV & Security, Stationery & Printing, Computer & IT, Networking, Mobile, Audio & TV, Other) by a direct SQL script. Every counter replica then failed InvProductGroup on the name unique index, which shows old groups and the "Copy incomplete" badge. Fix c02cf8440 (clearUniqueClashes in sync-engine/lib/pull.js) is committed on main; the owner said "release later".

**Why:** counters only heal after installing a release that carries the fix.
**How to apply:** at the next release, mention this fix in the notes and raise minimumCounterVersion (it touches sync). If the owner reports old groups or "Copy incomplete" on a counter before then, this is the cause. See [project_release_means_full_checklist](project_release_means_full_checklist.md).
