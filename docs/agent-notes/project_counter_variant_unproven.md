---
name: project_counter_variant_unproven
description: APP_MODE=counter strips routes the app still calls; it shipped broken as 1.3.7 and there is still no build gate to catch it.
metadata: 
  type: project
  modified: 2026-09-15T09:12:23.085Z
---

`APP_MODE=counter` is the POS-only build variant. It has **never been proven**, and on
2026-09-15 it shipped by mistake as v1.3.7 and broke the counters (party dropdown empty,
404 after login, thermal printing dead). Re-released the same day as an `office` build.

`counter-build.ts` renames route folders out of `src/app` for the duration of the build,
narrowing `src/app/api` to `COUNTER_API_ALLOWLIST` in `appModeCore.ts`. The surviving code
still calls what was removed:

- **`parties` in the allowlist does NOT cover customer search.** The party dropdown calls
  `/api/person` (and `/api/companies`) — different folders, both stripped. `/api/parties`
  only serves the cached catalog sync. This is the trap that looks correct and is not.
- The post-login destination is hardcoded `/office/work-flow-inbox` in
  `src/app/staff/login/page.tsx`, and `work-flow-inbox` is in `COUNTER_OFFICE_MODULE_STRIP`
  — so login 404s. The login page is not mode-aware.
- Also stripped but still called: `/api/print` (silent thermal bills), `/api/sync`
  (`/setup/counter` waits on `/api/sync/status`), `tickets`, `customer-quality`, `calls`.

**Nothing catches this.** `verify:package` only checks credentials in `counter.env`. The
permanent fix, not yet done: a build gate that scans surviving routes for `/api/<segment>`
calls the strip removes and fails the build. Widening the allowlist by hand just leaves
the next gap to be found by a shop that cannot bill.

Quick tell: a counter-variant installer is ~161 MB; office is ~170 MB.

Related: [project_release_tags_before_installer_build](project_release_tags_before_installer_build.md), [project_two_release_repos_same_name](project_two_release_repos_same_name.md)
