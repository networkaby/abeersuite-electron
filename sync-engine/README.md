# sync-engine

Keeps a counter's local PostgreSQL replica in step with Supabase.

> **Moved 2026-08-26.** This was a separate product — its own repo at
> `D:\AbeerSuite\tools\counter-sync`, its own installer, and its own SYSTEM scheduled
> task running beside the printer bridge, against a PostgreSQL installed by hand. It now
> lives inside the desktop app: Electron bundles PostgreSQL, creates the database,
> applies the schema, and supervises this worker as a child process. Owner decision —
> most counters have no PostgreSQL installed and everything ships in **one box**.
>
> The engine itself moved **unchanged**. It is proven against real data (113 tables,
> 20134 rows, exact match) and rewriting it would have traded that for nothing. Only
> three things were adapted, all marked in place: where the registry is found, where
> `config.json` is read from, and who starts it.
>
> The old repo still holds this code's git history and the retired
> `scripts/seed-replica.ps1`.

## Why this exists

Supabase bills per row read out of it. A report opened fifty times is billed fifty
times. A replica pulls each changed row **once** and then serves it locally, for
free, forever — so the driver here is **egress cost**, and offline capability is the
side benefit. The acceptance test for the whole project is a measured before/after
egress comparison, not "does it work with the cable pulled".

Full design: `~/.claude/plans/after-all-we-are-twinkling-lamport.md`.
Status: `PROJECT_BRAIN.md`.

## How a replica gets built now

No prerequisites on the counter, and no `pg_dump`:

1. `electron/postgresManager.ts` starts the **bundled** PostgreSQL 17.6
   (`resources/pgsql`, fetched by `pnpm pg:fetch`) and creates the database **with the
   source's collation** — see below, it is the subtle part.
2. `electron/localDbProvisioner.ts` applies `resources/local-schema.sql` (generated from
   the Prisma schema by `pnpm db:local-schema`: 113 tables, 52 enums) and creates the
   two roles.
3. This worker's **first cycle seeds it**. Every table starts on a NULL watermark, which
   already means "never synced", so the ordinary delta pull drains the whole table. The
   database is 29 MB; there is nothing to optimise here.

That third step is why the direct 5432 credential never reaches a shop PC. The retired
`seed-replica.ps1` needed session mode because `pg_dump` cannot use the transaction
pooler — the pull engine only issues ordinary `SELECT`s, so the pooler `DATABASE_URL`
the app already has is enough. `scripts/counterEnv.ts` withholds `DIRECT_URL` from
counters on purpose, and this keeps it that way.

### The two roles

`smx_sync` owns the replicated data and is what this worker connects as. It needs
`CREATE` on `public` (it creates its own `_sync_state`) and
`SET ON PARAMETER session_replication_role`.

`smx_app` is what the app connects as: `SELECT`, `INSERT`, `UPDATE` — deliberately **not
`DELETE`, not DDL**. The standalone tool gave the app a SELECT-only `smx_ro`, which was
right when every write went to Supabase. This counter reads *and writes* locally, even
offline, so the app needs to insert; withholding `DELETE` mirrors `createLocal()` in
`src/shared/lib/prisma/prismaClient.ts`, which blocks it unconditionally on the replica
because a delete replayed against a row another counter has since changed is not
recoverable.

### Collation is the subtle part

A replica created with a different collation sorts text differently, so `ORDER BY
name` returns a **different row order** locally than live. No error, no checksum
mismatch, no failed query - just reports that quietly disagree, which is the worst
failure mode for a database you are trusting for reads.

Supabase reports `en_US.UTF-8`. That is a **Linux** locale name, and Windows
PostgreSQL cannot use it: its libc provider only knows Windows locale names. So on a
POSIX-named source the script switches to **ICU**, which is platform-independent and
names locales as BCP-47 tags (`en_US.UTF-8` -> `en-US`). PostgreSQL 17 from the EDB
installer ships with ICU.

**ICU and glibc are close but not identical.** Most real names and product codes
sort the same under both; the differences appear around punctuation, case, and
accents. That is why the script ends with a **sort probe** that hashes the first 500
`Person` names ordered on each side and compares them. Treat its verdict as the
answer, not the theory:

- *matches* - good, proceed.
- *differs* - text-ordered reports will disagree with live. Decide before trusting
  local reads for anything ordered by name.

The script tries, in order: ICU with `LC_COLLATE 'C'`, ICU inheriting template0's
locale, then the exact libc name (which is what works when the counter is Linux).
It fails loudly rather than silently accepting the Windows default.

## Wiring the app to it

Nothing to wire by hand any more. `electron/main.ts` sets `LOCAL_DATABASE_URL` (to the
`smx_app` role) and `COUNTER_PC=true` from the *actual* outcome of provisioning, and
`READ_MODE` ships in `resources/counter.env`.

`LOCAL_DATABASE_URL` is what switches the machinery on at all. Without it the app builds
no Proxy and `prisma` **is** the live client, same object — which is what keeps Vercel
and every ordinary laptop provably unchanged. `pnpm check:counter-mode` asserts exactly
that. Note main.ts **clears** it when provisioning fails, rather than leaving it pointing
at an unprovisioned database: `reportLiveDown()` demotes reads to LOCAL on any transient
Supabase error, so a stale value would turn a brief blip into pages rendering zero rows.

`READ_MODE=local` is the egress win and gates on `replicaReady`, which
`refreshReplicaReadiness()` reads from the `_sync_status` row this worker writes. So it
**fails closed**: until a cycle has actually completed, reads keep going to Supabase.
Move through `shadow` first if you want a proving week.

## Two things that must never happen

- **Never run a seed against the replica.** `bootstrap-seed` and `personal-bootstrap`
  mint autoincrement ids; the replica's ids must stay byte-identical to Supabase's,
  because a `User.id` in a JWT and a `universalVoucherId` on a ledger line resolve
  against whichever database answers. A colliding id attaches a session or a ledger
  line to the wrong record, silently. Both seeds refuse to run when `COUNTER_PC=true`
  or `LOCAL_DATABASE_URL` is set (`prisma/seeds/lib/assertNotCounter.ts`).

  This is also why **offline writes need per-counter id ranges** before they ship: the
  schema uses `@default(autoincrement())` on 79 models, sequences are per-database, and
  two counters writing offline would both mint `id = 101`.
- **Never let credentials into the package.** `config.json` holds connection strings for
  BOTH databases. It is written at runtime into Electron's userData (see
  `electron/syncManager.ts`) and is excluded from the package by an `extraResources`
  filter **and** asserted against by `scripts/verify-package.ts`, which fails the build
  if one is ever found inside. The precedent is real: `public/combined-bridge.zip`
  shipped a live API key in a `config.json` served pre-auth. Repeating that with database
  passwords is a different order of problem.

## Running a sync cycle

```powershell
node sync-once.js            # one cycle
node sync-once.js --dry-run  # report what would move, write nothing
node sync-once.js --only Ticket
```

Config is `config.json` (copy `config.example.json`). It holds both database
credentials and is gitignored.

### What a cycle does

**Pass 1 - independent tables.** `watermark` and `append` pull rows past the stored
high-water mark; `full` tables replace wholesale.

**Pass 2 - children, shallowest first.** When a parent moved, its whole child set is
re-materialised. That is what makes child deletes exact: a watermark can say "this
row changed" but never "this row is gone". Nesting is handled — `TicketOrderLine`
sits at depth 2 behind `TicketOrder` behind `Ticket`, so its parent's ids are already
known by the time it runs.

### Two things that keep it cheap

**A `full` table is fingerprinted before it is copied.** Replacing 22 reference
tables every cycle would re-read them from Supabase forever, for data that changes
maybe monthly — self-defeating when egress is the entire point. A count plus a hash
of every primary key is two numbers on the wire; only a mismatch pays for the rows.
A steady-state cycle currently transfers **0 rows in ~0.6s**.

**The count is not enough on its own**, which is why the key hash is there: delete
one row and insert another between cycles and the total is unchanged while the
contents are not. Verified both ways — the fingerprint catches a one-for-one swap,
and reproduces exactly when the original contents are restored, so it does not cause
false re-transfers.

### The cursor is (timestamp, primary key), not the timestamp

This one is not a refinement, it is a correctness requirement, and real data proved
it: **all 3529 `Person` rows share a single identical `updatedAt`** from a bulk
import. With a timestamp-only cursor, a page ending anywhere inside that block
advances the mark past the *whole block*, and every remaining row in it becomes
permanently invisible — no error, no retry, the rows simply never arrive.

Adding the primary key makes the ordering total, so a page boundary can fall inside
a tie without losing anything. Verified by deleting 1500 rows locally, clearing the
cursor, and re-syncing: all 3529 came back and the fingerprints matched exactly.

(`InvProductBranch` is the one watermarked table with a compound key and falls back
to the timestamp alone; a tie there would have to exceed a whole page to lose
anything.)

The stored cursor is the largest value **seen**, never `now()` — taking the clock
would skip any row committed during the query but stamped just before it, the same
silent hole by a different route. `_sync_state` (local only, keyed on the registry's
stable table number) carries one row per table so "never synced" stays
distinguishable from "nothing to do".

A cycle **drains** a table rather than leaving a backlog: a counter that has been
offline can be many pages behind, and stopping after one page would mean it never
catches up while changes keep arriving.

### Reconciliation — the only thing that catches deletes

A watermark reports that a row **changed**; it can never report that a row is
**gone**. So each cycle re-proves a few tables equal to the source, oldest proof
first, budgeted so the cost is spread rather than arriving as a periodic stall.

Only `watermark` and `append` tables are reconciled. `full` is exact by construction
(replaced wholesale) and `child` is exact for any parent that moved, so spending
queries on them would buy nothing.

The cheap check runs first (count + key hash, two numbers per side). Only a mismatch
pays to move keys, and then both directions are repaired:

- **onlyLocal** — deleted upstream. Nothing else can ever detect this.
- **onlySource** — present upstream, missing here, with a timestamp already *behind*
  the cursor, so no future delta pull would look at it again. Left alone it stays
  missing for the life of the replica.

After repairing, the table is re-fingerprinted before being marked verified — if it
still differs, no proof is recorded and the next cycle looks again.

Verified by injecting divergence in both directions at once (5 rows deleted locally,
1 bogus row inserted) and watching a cycle report `Device repair -1 +5`, after which
a full compare was exact again.

### Syncing on a signal instead of a timer

The app already broadcasts `{ topics, at }` on every successful write, and the
counter and the office share one Supabase Realtime channel — so when office staff
post a purchase on Vercel, this worker hears it for free and syncs only what moved.
Polling every table on a schedule is the expensive way to notice a change, and
egress is the whole reason this project exists.

**The signal is a hint, never the source of truth.** It is published by an axios
interceptor running *in a browser*, so a write made by a script, a seed, a
GitHub-Actions restore, or a browser whose publish failed emits nothing at all.
Treating it as authoritative would mean silently missing those changes forever. It
only ever makes a sync happen *sooner*; correctness comes from the watermarks and
the reconcile pass, which run regardless.

A burst settles for 750 ms before syncing — one user action is several requests
(save, re-read, badge refresh), each announcing itself. Verified live against
Supabase: four signals in quick succession produced **one** sync carrying the union
of their topics (23 models).

Topic→model expansion lives in the worker, not on the wire: the publisher derives
its topic from the API path and has no idea which tables a route touched. An unknown
topic falls back to syncing everything — over-syncing costs a cycle, under-syncing
loses data. The map is hand-maintained, so `staleModels()` checks it against the
registry at startup; a dead entry would otherwise quietly narrow what a signal
covers.

Configure with `supabaseUrl` / `supabaseAnonKey` (the app's `NEXT_PUBLIC_*` values —
client-exposed by design, not secrets). Omit them and the worker uses the timer alone.

## Verifying the replica

```powershell
node verify-replica.js          # count + key checksum, every table
node verify-replica.js --keys   # also list differing ids (transfers keys)
```

The failure this guards against is silent: a replica missing rows does not error, it
renders a report with fewer lines — which reads as "those records do not exist"
rather than "this database is behind". Cheap enough to run often (two numbers per
table per side; nothing transferred unless a table disagrees and `--keys` is passed).

Last full run against Supabase: **113 tables, 20134 rows each side, exact match.**

### Grants it depends on

`smx_sync` needs `CREATE` on `public` (it owns `_sync_state`) and
`SET ON PARAMETER session_replication_role` (foreign keys are suspended per
transaction, so parents and children can be written in any order). `seed-replica.ps1`
grants both; `scripts/retrofit-grants.sql` adds them to a replica seeded earlier.

## Running it as a service

```powershell
node index.js      # or: npm start
```

Deliberately thin — a scheduler around `sync-once.js`, which stays runnable on its
own. That separation is what let the engine be tested against a real replica rather
than only in theory, and it means a failing cycle can be reproduced by hand through
the exact same code path.

**Each cycle runs as a child process.** A sync touches every table and holds two
database connections; running it in-process for weeks means one leak or one wedged
connection takes the service down permanently. A child that dies is just a failed
cycle, and the next tick starts clean.

Three things trigger a cycle: a change signal (~1s), the 10-minute interval (the
safety net, since a signal is only ever a hint), and startup. A signal arriving
mid-cycle queues one more rather than running two at once — concurrent cycles would
fight over the same tables and watermarks.

Schema drift backs off hard (3x interval) instead of retrying on the usual schedule:
it is a fault only a deploy can fix, so retrying quickly would just bury the log.

Verified live: published a `ledger` signal and the service began a cycle 1.3s later.

## Schema drift and readiness

There are no Prisma migrations here (schema is applied with `db push`), so there is
no migration hash to compare. The worker instead compares `information_schema`
column-by-column on both sides, over SQL — no HTTP hop, no endpoint to secure, since
it already holds a connection to each.

**Missing or retyped columns halt the sync** (exit 4). A column added upstream but
absent locally means rows arrive quietly incomplete — a report renders with a field
permanently blank rather than raising anything. A column dropped upstream leaves a
harmless unused column here and does *not* halt; the next reseed clears it.

After every cycle the worker writes `_sync_status` (one row): schema state, whether
every table has synced at least once, table counts and worst lag. The app reads it
through its SELECT-only role to decide whether local reads are safe, and **fails
closed** — table absent, no permission, connection refused all leave the replica
not-ready, so reads keep going to Supabase.

Verified by renaming a column on the replica: the cycle halted with exit 4,
`_sync_status.ready` went false with the reason, and renaming it back recovered on
the next cycle.

## Installing on a counter PC

There is no separate install. This ships inside the AbeerSuite installer
(`extraResources` → `resources/sync-engine`) and `electron/syncManager.ts` starts it
when the replica has been provisioned, stopping it on `will-quit` beside the embedded
PostgreSQL.

It runs under `ELECTRON_RUN_AS_NODE`, so the Electron binary acts as plain Node and the
counter needs no Node runtime of its own.

The autostart toolkit that used to live here (`register-autostart.bat`,
`setup-autostart.bat`, `start-hidden.vbs`, `bootstrap.ps1`, …) and the "SMX Counter
Sync" scheduled task are all gone: the app's own lifecycle replaces them. They remain in
the old `tools/counter-sync` repo if anyone needs the history.

One behaviour worth keeping in mind from that arrangement: the scheduled task was
**ONSTART/SYSTEM** so the replica kept catching up regardless of who was logged in.
Tied to the app, syncing now only happens while AbeerSuite is running — which is fine
for a till that is open all day, but means a counter left closed for a week catches up
on next launch rather than overnight.

## Two dials, and the trigger that depends on this worker (2026-08-28)

`READ_MODE` decides where READS are served from. `WRITE_MODE` (`live` | `local`) decides
where WRITES land, and picks the client the read dial rides on — a `$transaction` is a
write, so it opens on the WRITE_MODE client and every read inside it stays on the same
database. Both default to `live`.

Under `WRITE_MODE=local` this worker is only half the picture. The app writes its
replica directly; those writes are captured by an `_outbox_capture` trigger on every
replicated table (generated into `resources/local-schema.sql` from the same
`sync-tables.json` this worker reads) and pushed up by a flusher running inside the Next
server.

**That trigger is why this worker must keep using `session_replication_role = replica`.**
Ordinary triggers do not fire in replica mode, and that is precisely what stops rows
pulled down here from being queued straight back up — echo suppression comes for free
from a mechanism this engine already had. Two things must stay true:

- `inReplicaTransaction()` in `lib/db.js` wraps every local write in `pull.js`. Do not
  add a write path to a replicated table that skips it, or the next cycle will fill the
  outbox with the entire pulled dataset.
- The triggers are created with plain `CREATE TRIGGER`. Never `ENABLE ALWAYS`, which
  would fire them in replica mode too and defeat the whole arrangement.

The app role is also deliberately NOT granted `SET ON PARAMETER
session_replication_role`, so the app cannot silence its own capture.

## Not built yet

`AuditLog` tombstones — voucher deletes currently wait for the reconcile sweep
rather than propagating immediately.

`READ_MODE` can move to `shadow` whenever you want to start proving the replica
against live traffic; `local` after that.
