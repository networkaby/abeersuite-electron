---
name: project_office_colour_rollout
description: Office-wide module-colour rollout — what shipped 2026-09-16 and the batches still open
metadata: 
  type: project
  modified: 2026-09-16T02:20:31.055Z
---

Owner asked (2026-09-16) to spread the Customers-page colour treatment across all
177 office pages, "dynamically page wise so we don't get bored", and said "do the
best, i trust you" on both the colour rule and the batching.

**Settled colour rule:** hue says which MODULE, shade says which part of it,
layout says which page. Per-page hue was rejected — the 12 `--m-*` tokens already
sit exactly 30° apart, so a 13th is a near-twin, and the sidebar is an always-on
legend a per-page hue would contradict. Per-section shade is deferred until the
layout batches land; a 26-agent survey concluded the monotony is really 62
near-identical accountancy pages, which **page archetype** fixes, not colour.

**Shipped** (commit 27455528): `moduleInk()` + `--m-ink-mix` token, the theme-only
prefix table in `active-module.ts` (settings→settings, admin→administration), and
hues for `retention` (245) and `pricing-strategy` (125).

**Still open**, roughly in value order: revive `DataPageHeader` + `OfficeModuleHub`
(both have zero importers, so editing them is free); the accountancy sweep — 8
shared files repaint ~40 of its 62 pages; four missing section layouts (bi, pos,
customers, repairing) — BI's 21 pages have no breadcrumb at all; settings/admin
nav chrome; then header adoption across ~77 pages.

See [project_stale_turbopack_css_cache](project_stale_turbopack_css_cache.md) before browser-verifying any of it.
