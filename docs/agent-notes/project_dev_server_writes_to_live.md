---
name: project_dev_server_writes_to_live
description: "The local dev server on :3000 may be pointed at the live Supabase DB for reads and/or writes — check .env.local's DATABASE_URL, READ_MODE and WRITE_MODE before verifying."
metadata: 
  type: project
  modified: 2026-11-04T08:43:32.074Z
---

**2026-10-24: `.env.local` has every DATABASE_URL commented out → a dev server falls back to `.env` = LIVE Supabase.** Re-check each time.
**2026-11-04: it flipped twice in one day** — `abeersuite_dev` lines were active (an "apply to live" via :3000 silently hit the local copy), then commented out again at the owner's request. Prove which DB :3000 serves by reading a value that differs between the two before any write; a restart only counts once the OLD process on :3000 is gone (a second `next dev` starts but never gets the port).

**Check `.env.local` before assuming either way** — it is loaded ahead of `.env` and its values win. As of 2026-09-20 its `DATABASE_URL`/`DIRECT_URL` point at a LOCAL database ([project_abeersuite_dev_local_copy](project_abeersuite_dev_local_copy.md)), **but it also sets `READ_MODE=live` and `WRITE_MODE=v_live`** — so the running app does not necessarily read or write the database Prisma CLI commands touch. When `.env.local` carries no URL override, `.env`'s `DATABASE_URL` is the live Supabase pooler and `pnpm dev` on :3000 reads and writes the owner's **real books** (as of 2026-09-16: ₹6.95 lakh outstanding, 312 open bills).

**Resolved by measurement on 2026-09-21** (same `.env.local`): the relay is OFF and
the app reads *and* writes the LOCAL `abeersuite_dev` copy, not Supabase.
`WRITE_MODE=v_live` only relays when `RELAY_ACTIVE` is true, and that needs
`IS_COUNTER_PC` — but `.env.local` sets `COUNTER_PC=false`, which overrides `.env`'s
`true`. `READ_MODE=live` then means "the DATABASE_URL database", which `.env.local`
points at localhost. Proof, not inference: the app's maintenance dry run reported
`withActivity: 300` and `abeersuite_dev` has exactly 300 accounts with GL activity.
So with THIS `.env.local`, write-path testing is safe. Re-check the three knobs
(`COUNTER_PC`, `READ_MODE`, `DATABASE_URL`) before relying on that again.
Owner confirmed on 2026-10-02: "`.env.local` — its dev db not live". Then `DATABASE_URL` was
`localhost:5432/abeersuite_dev`, so `seed:sync-permissions` with `LOCAL_DATABASE_URL=` inline was the right path.

**Why:** browser verification is the normal way to prove a change here (see [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md)), but clicking Save on a voucher screen posts a real numbered bill, moves real stock and burns a voucher series number.

**How to apply:** read-only verification is free — drive the UI, open dialogs, check pickers, computed totals and disabled states, and `fetch` the app's GET APIs. Before anything that **writes**, stop and ask the owner. Two traps that cost real time on 2026-09-20, both of which look like a bug in new code:

- **Turbopack's first compile of a route is slow** — 20–40s, and the screen sits on `QueryStateBlock`'s spinner the whole time while the API itself answers in under a second. **Do not conclude the environment is broken.** Wait, reload, and try again before reporting a stall; a pre-existing screen spinning too usually means "still compiling", not "environment fault".
- **A server started before `prisma generate` 500s on the new model** — restart it ([project_next_dev_restart_after_generate](project_next_dev_restart_after_generate.md)). `next dev` refuses a second instance in the same folder, so stop the process on port 3000 first rather than trying to start your own alongside it.
