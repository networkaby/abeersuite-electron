---
name: project_db_probing_via_dev_server
description: "How to reach the database from Bash here — node+pg with TLS relaxed works against live; older ECONNREFUSED advice was about a different env file."
metadata: 
  type: project
  modified: 2026-09-16T21:45:58.490Z
---

**Live Supabase IS reachable from the Bash tool** (confirmed 2026-09-13, read-only
schema + count queries). Two things have to be right:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "require('dotenv').config(); const {Client}=require('pg'); ..."
```

- `require('dotenv').config()` — Bash scripts do not pick `.env` up on their own.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` — without it the pooler fails with
  *self-signed certificate in certificate chain*. Passing `ssl:{rejectUnauthorized:false}`
  to `new Client` does NOT work **on its own** — the `sslmode` in the connection
  string overrides it. It DOES work once `sslmode` is stripped first, which is
  what every script in `src/scripts/` does and why they connect to live fine:
  `raw.replace(/[?&]sslmode=[^&]*/g,"")`, then `ssl: isLocal ? false : {rejectUnauthorized:false}`.
- Table names are PHYSICAL, not model names — 17 models are `@@map`'d
  (`PosCounter` → `pos_counters`). Check the schema before assuming.

**But check which database is actually active first.** `.env.local`, when present,
points `DATABASE_URL`/`DIRECT_URL` at a LOCAL Postgres — pass it explicitly:
`U=$(grep DIRECT_URL .env.local | ...); DATABASE_URL="$U" npx tsx script.ts`.

**Why it matters:** the earlier `ECONNREFUSED` rule sent every data question
through the browser pane, which needs a dev server AND a logged-in session. A
direct read-only query answers a factual question in seconds — use it for
"does this column exist", "how many rows look like X", schema and migration state.

**A tsx script CAN reach live — but never through the app's global Prisma client.**
`@/shared/lib/prisma/prismaClient` is wired for counter mode and the local replica,
so any shared helper that hardcodes it fails from a script with a confusing
*"The server does not support SSL connections"*, raised frames away from the real
caller. Importing the module is fine (it connects lazily); only *using* it breaks.
Fixed for `accountIdsUnderGroup` / `partyLedgerIds` on 2026-09-16 (a1cf819d) — they
take the client now. Expect other shared helpers to have the same wiring; check
before reusing one in a script.

**Simplest route of all — `psql` is on this machine** (confirmed 2026-09-17):
`/c/Program Files/PostgreSQL/17/pgAdmin 4/runtime/psql.exe` (also a bundled copy in
`resources/pgsql`). It takes `DIRECT_URL` straight from `.env` with no TLS fiddling:

```bash
DU=$(grep -E '^DIRECT_URL=' .env | head -1 | sed 's/^DIRECT_URL=//' | tr -d '"\r')
"/c/Program Files/PostgreSQL/17/pgAdmin 4/runtime/psql.exe" "$DU" -f query.sql
```

Open every script with `SET default_transaction_read_only = on;` — it makes a stray
write impossible at the session level, not just by intention. `\echo` only works via
`-f file`, not `-c`. Write the .sql into the scratchpad dir and pass psql the **Windows**
path. This beat the browser pane outright when the preview session got revoked mid-hunt.

**How to apply:** read-only probes → `psql -f` as above, or `node -e`. Anything that must go
through app logic (permissions, caching, business rules) still belongs in the
browser pane against the dev server's own APIs. Never write from an ad-hoc script
against live. See [project_schema_ships_via_migrations](project_schema_ships_via_migrations.md),
[feedback_dry_run_must_exercise_write_path](feedback_dry_run_must_exercise_write_path.md).
