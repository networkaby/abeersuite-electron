---
name: project_next_dev_restart_after_generate
description: "A running next dev keeps the old Prisma client after prisma generate (new relations 500); a killed or power-cut next dev leaves .next/dev stale so routes 404 or hang on compile — restart clean."
metadata: 
  type: project
  modified: 2026-09-30T00:05:38.882Z
---

Two dev-server traps met on 2026-09-20 while adding the HR tables:

1. **Stale Prisma client.** The owner's `next dev` (started before `prisma generate`) answered 500 on every route selecting the new `staffProfile` relation — `/api/users` included — while a direct query from a tsx script worked. The running process must be restarted after `prisma generate`; HMR does not reload the generated client.
2. **Stale route cache.** After killing that server and starting a new one, `/api/auth/session`, `/staff/login`, `/api/hr/staff`, `/api/sync/status` answered 404 (as HTML) although the folders existed, and `/api/users` was fine. `.next/dev` (with its `lock`) belonged to the killed process. `preview_stop`, `rm -rf .next/dev`, `preview_start` fixed it; first requests then take 30–60 s to compile.

3. **Stuck compile (2026-09-30).** Routes whose code had changed hung for 90–540 s and never appeared in the log. Routes already compiled answered in under a second, and `node` sat at 8 GB and pegged CPU. A power cut hit while Turbopack was "writing to filesystem cache". Clearing `.next/dev` and restarting fixed it: the cold start then took 46 s on `/api/health` and 16 s on a changed route. A hang like this is the cache, not the code; clear it before suspecting the code.

**How to apply:** the port-3000 process is `next dev` from this repo (parent `node …/next dev`, child `start-server.js`); check with `Get-CimInstance Win32_Process`. Stop both PIDs, clear `.next/dev`, start with `preview_start` "Next.js Dev Server" so logs are readable. Leave the production `.next` build files alone. Curl the routes before trusting the browser. See also [feedback_hidden_browser_pane_starves_effects](feedback_hidden_browser_pane_starves_effects.md) — clicks by `ref` did nothing on a hidden pane; `tabs_select` + a coordinate click worked.
