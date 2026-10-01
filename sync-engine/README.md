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

**Four tables at a time (2026-09-03).** An idle cycle is ~80 small round-trips to
Supabase; run one after another on a single connection they cost ~0.6 s of pure
latency. Tables inside a pass are independent of each other — foreign keys are
suspended per transaction, and `_sync_state` is one row per table — so each pass now
runs `CONCURRENCY` (4) tables in parallel, each on its own pair of pooled connections.
Pass 2 keeps its ordering by running one depth at a time: a depth-2 child filters on
ids its depth-1 parent has only just finished writing. Pass 3 is unchanged (already
budgeted). `__SYNC_APPLIED__` still prints once, after every lane has committed.

**Pass 4 - running totals.** Pulled rows never overwrite `Account.balance`, stock or
`GiftCard.balance` (`cacheColumns`); this pass re-sums the ones the cycle's ledger rows
moved, from the local ledger (`lib/rebuildTotals.js`). The ids are noted in
`_sync_dirty` **on the same transaction as the page** that moved them and cleared only
after the rebuild (2026-10-01). Until then they lived in the cycle's memory: a cycle
killed after a ledger page committed — the app closed mid-sync, a Windows shutdown, the
cycle timeout, a relay pre-empting it — had already moved that table's cursor, so no
later cycle saw those rows again and the totals stayed wrong until something else
touched the same ids. Now the next cycle finishes the job (and announces it, so a
balance screen re-reads even when that cycle pulled nothing).

### The engine's own tables

`_sync_state` (cursors and verify proofs), `_sync_status` (readiness) and `_sync_dirty`
(totals owed) are created by the engine, as `smx_sync`, from one column list each
(`lib/bookkeeping.js` `ensureTable`). Every column is re-declared with
`ADD COLUMN IF NOT EXISTS` on each cycle, so a column added in a later build reaches a
till that already has the table — `CREATE TABLE IF NOT EXISTS` alone skips the whole
statement once the table exists, and until 2026-10-01 `_sync_status` had nothing else, so
`publish()` would have failed every cycle on the first new column. A new column must be
nullable or carry a DEFAULT. They stay out of `resources/local-schema.sql` on purpose: the
provisioner applies that file as the database owner before `smx_sync` exists, and the
engine could then no longer alter its own tables.

### Two things that keep it cheap

**A `full` table is fingerprinted before it is copied.** Replacing 22 reference
tables every cycle would re-read them from Supabase forever, for data that changes
maybe monthly — self-defeating when egress is the entire point. A count plus a hash
is two numbers on the wire; only a mismatch pays for the rows. A steady-state cycle
currently transfers **0 rows in ~0.6s**.

**The count is not enough on its own**, which is why the hash is there: delete one
row and insert another between cycles and the total is unchanged while the contents
are not. Verified both ways — the fingerprint catches a one-for-one swap, and
reproduces exactly when the original contents are restored, so it does not cause
false re-transfers.

**For a `full` table the hash covers the whole row, not just the key.** A key hash
cannot see an edit in place — release a counter (`boundDeviceId` → null), rename a
department — and a table without a watermark has no other way to notice, so the
replica kept the old value forever. `reconcile.fingerprint()` hashes `to_jsonb(row)`
for those tables; the source query also returns its column list in the same statement
and the replica hashes only those columns, so a stale replica-only column cannot make
the sides disagree. Both pools pin the session to UTC so time renders identically.
Watermark tables hash each key together with its `updatedAt` — see *An edit stamped
behind the cursor* below.

### The cursor is (timestamp, primary key), not the timestamp

This one is not a refinement, it is a correctness requirement, and real data proved
it: **all 3529 `Person` rows share a single identical `updatedAt`** from a bulk
import. With a timestamp-only cursor, a page ending anywhere inside that block
advances the mark past the *whole block*, and every remaining row in it becomes
permanently invisible — no error, no retry, the rows simply never arrive.

Adding the primary key makes the ordering total, so a page boundary can fall inside
a tie without losing anything. Verified by deleting 1500 rows locally, clearing the
cursor, and re-syncing: all 3529 came back and the fingerprints matched exactly.

(`InvProductBranch` and `VoucherSeriesCounter` are the watermarked tables with a
compound key and fall back to the timestamp alone; a tie there would have to exceed
a whole page to lose anything.)

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

`watermark`, `append` and `child` tables are reconciled; `full` is exact by construction
(replaced wholesale). `child` is compared on row **contents**, not keys — see *What a
key hash cannot see* below. `child` used to be skipped on the argument that it is exact for
any parent that moved — which is true, and not enough: a child row inserted without
touching its parent's `updatedAt` never moves the parent, so it is never pulled, and
nothing else ever looked at that table. Found on a real replica on 2026-09-03: 26
`LoyaltyLedger` and 24 `LoyaltyLot` rows in Supabase, 0 locally, every cycle reporting
"0 failed". A child table costs the same two numbers to prove as any other.

The cheap check runs first (count + key hash, two numbers per side; on a `watermark`
table the hash covers each key with its `updatedAt`). Only a mismatch pays to move keys,
and then every direction is repaired:

- **onlyLocal** — deleted upstream. Nothing else can ever detect this.
- **onlySource** — present upstream, missing here, with a timestamp already *behind*
  the cursor, so no future delta pull would look at it again. Left alone it stays
  missing for the life of the replica.
- **stale** — on both sides, last changed at a different time: an edit stamped behind
  the cursor. See *An edit stamped behind the cursor* below.

After repairing, the table is re-fingerprinted before being marked verified — if it
still differs, no proof is recorded and the next cycle looks again.

#### A row the cloud has never seen is not an upstream delete

`onlyLocal` has a second meaning the comparison cannot see: **a row this counter wrote
and has not pushed yet.** A counter is not a pure downstream replica — it is an origin
for its own sales, shifts and counter rows, which reach Supabase later through
`_outbox`. Until the push lands, such a row is absent upstream because the cloud has
not seen it, and deleting it destroys the only copy. For most tables the outbox payload
survives and the row returns once pushed (a sale vanishing from the till for a while).
For `VoucherSeriesCounter` — one row per `(kind, counterNumber)`, written only by that
counter — the allocator re-creates the missing row from zero first, and the till
re-issues invoice numbers already printed on customers' bills. Silently.

So `deleteByKeys` (`lib/pull.js`) holds back two kinds of key, and every caller goes
through it:

- **Still in the outbox** (`lib/outboxGuard.js`): keys with a pending `_outbox` row
  (`pushed_at IS NULL AND dead_lettered_at IS NULL`, the pending index's predicate).
  Dead-lettered rows are deliberately *not* held — a permanently refused row would keep
  its table from ever verifying, and every till would pay a full key transfer from
  Supabase hourly for it. The badge already shouts about dead letters and the payload
  is still in `_outbox`.
- **`localAuthority`** tables (registry `overrides`): this machine owns its rows and
  the cloud is never the authority. Nothing is deleted, pushed or not — this closes the
  dead-letter and upstream-delete cases for the one table where the loss is
  unacceptable. Adds and updates from the source still apply — which is why the
  writers upstream must never touch another machine's row: the office's "Reset Counter"
  bumps `VoucherSeries.resetGen` instead of zeroing every counter's row, and each
  counter zeroes its own the next time it numbers. The app's push path reads the same
  flag and never drops such a row as "superseded" by a newer cloud copy.

The log says `held N local row(s) not yet pushed`; such a table stays unverified until
the push lands, which is the truthful state.

The join is on `_outbox.row_key` (typed jsonb), **not** `row_pk`: the trigger joins
compound keys with `chr(31)` while `keyExpression` joins them with the four-character
literal `\x1f` (`standard_conforming_strings` is on), so `row_pk` would never match and
the guard would silently protect nothing on exactly the compound-keyed tables. The
separator is one exported constant, `KEY_SEPARATOR`.

Covered by `pnpm test:reconcile` (check 4).

Verified by injecting divergence in both directions at once (5 rows deleted locally,
1 bogus row inserted) and watching a cycle report `Device repair -1 +5`, after which
a full compare was exact again.

### What a key hash cannot see: same key, different row (2026-09-08)

The cheap check hashes **primary keys**. So it answers "is a row missing or extra?"
and nothing else. A row present on both sides whose *contents* differ reads as
agreement, forever — the watermark will not re-pull it either, if `updatedAt` did not
move. Two real causes, both found on a live counter:

**1. A foreign key action on the source.** `ON DELETE SET NULL` fires inside
PostgreSQL, so Prisma's application-level `@updatedAt` never runs and the row's
timestamp does not move. Here the same delete is applied under
`session_replication_role = replica`, which suspends FK actions on purpose so rows can
land out of dependency order — so we never make the matching change and are left
holding a key that no longer exists. Seen as `Person 8282` keeping
`convertedToCompanyId = 17` for six weeks after the office had nulled it, while every
verify reported the table clean. This schema has **95** `ON DELETE SET NULL`
constraints, all single-column.

*Fixed* by `repairReferencing` in `sync-once.js`: after `deleteByKeys` removes parent
keys, every table referencing that parent through a SET NULL / SET DEFAULT foreign key
has its affected rows re-pulled from the source. The source is the authority — we copy
its answer rather than re-implement FK semantics against 95 constraints. Every delete
reaches a replica through that one function, so one hook covers the class. It costs
nothing on a cycle where nothing was deleted.

`ON DELETE CASCADE` needs no such handling: it removes the child on the source, which
is a **key** difference the ordinary fingerprint already catches.

**2. A `child` row edited without its parent moving.** The mirror of the 2026-09-03
insert bug above. A child table has no watermark of its own — it is pulled when its
parent's `updatedAt` moves — so an *edit in place* that does not touch the parent is
invisible to both the pull and the key hash. Seen as `UserSurfaceSeen` holding a
`seenAt` two days behind the source on 7 rows, verified clean every cycle.

*Fixed* by hashing row contents for `child` tables too, on exactly the argument `full`
tables already win on: a table with no watermark of its own has nothing but the
fingerprint to detect a change. Two consequences worth knowing:

- The reconcile's two fingerprints can no longer run in parallel. A content hash has
  the replica hash only the columns the SOURCE still has, so the source's list must
  come back first — otherwise a column the replica carries and the source has dropped
  reads as a permanent difference.
- A content mismatch can occur with the key sets identical, which `keyDiff` has
  nothing to say about. Pass 3 therefore also runs `rowHashDiff` and re-pulls what it
  finds. Without that the repair would move nothing, the re-fingerprint would still
  differ, and the table would never be marked verified — an hourly loop making no
  progress.

The cost is a sequential scan of each child table on both sides, at most once per
`VERIFY_INTERVAL_MS`. Cheap on this schema today (35 child tables, the whole database
20,748 rows); the ones to watch as volume grows are the line-item children —
`InvStockLedger`, `VoucherGlLine`, `VoucherInventoryLine`, `TicketOrderLine`.

### The repair has to overrule the monotonic guard

`upsert` normally refuses to overwrite a row with one whose `updatedAt` is not strictly
newer — the right rule for pulls that can arrive out of order. It is exactly wrong for
a repair: the entire class of divergence above has **identical `updatedAt` on the two
sides**, so `EXCLUDED."updatedAt" > "table"."updatedAt"` is false, the write is
silently skipped, and the repair reports rows fetched while changing nothing.

`pullByKeys` therefore forces the write, and defaults to doing so, because every one of
its callers is reconciliation — which has just compared the two sides and knows the
source's copy is the truth. It does not need a tiebreak. `cacheColumns` (running
totals) are still excluded; those are re-summed locally by `rebuildTotals.js`.

Found by `test-reconcile.js`, not by review: the first version of the FK repair passed
every check except the one that read the row back off disk.

### An edit stamped behind the cursor (2026-10-01)

A delta pull only looks past its cursor, and the cursor is the largest stamp *seen*. An
edit whose `updatedAt` lands behind it is never pulled, and until now never repaired
either — a key hash cannot see it, because the key set is unchanged. (A missed *new*
row was already healed by `onlySource`.) Three ways it happens:

- **A late commit.** `updatedAt` is stamped when the writer's statement runs, not when
  its transaction commits. A voucher save stamped 10:00:00 that commits at 10:00:05 is
  invisible to a pull at 10:00:02, which may carry the cursor to 10:00:01.
- **An offline counter pushing.** The push keeps the counter's own stamp, which can be
  hours behind every other till's cursor.
- **A refused push, or a skewed clock.** The office drops a replay that would un-post a
  voucher or reopen a closed shift, and the push comments promise "the counter converges
  at the next pull" — but the office's copy is stamped behind the cursor, so no pull ever
  brought it back.

Two layers close it:

1. **Hourly, in the reconcile.** A `watermark` table's fingerprint hashes
   `key || updatedAt` (`reconcile.stampColumn`), so a missed edit makes it disagree;
   `keyDiff` then also returns **stale** keys and `refreshByKeys` re-pulls them,
   forcing past the monotonic guard like every repair. It holds the same two things
   `deleteByKeys` holds: a row still waiting in `_outbox` (this counter's own newer
   edit on its way up) and every row of a `localAuthority` table. Those tables, and
   `append` tables (whose `createdAt` an edit never moves), keep the key-only hash.
   Stamps render fixed-width (`to_char … .US`) so both servers agree byte for byte and
   text order is time order.
2. **Every cycle, for a late commit.** Before draining a cursor table, `recheckBehindCursor`
   compares `(key, stamp)` over the last 60 s behind the cursor the previous cycle left
   and pulls what is newer upstream (or missing here) — the ordinary monotonic guard
   applies, since this is a delta pull reaching back. Skipped once that cursor is older
   than 15 minutes (no transaction runs that long), so a quiet table pays nothing; the
   horizon outlasts the 10-minute interval cycle, so a late commit no signal announced
   is still caught by the next scheduled one. Not on a `relay` cycle. Its ids go to the
   children, so a late voucher edit brings its lines.

The first hourly pass after this ships repairs whatever stamp drift a till already has,
once; after that a table only mismatches while one of its rows is pending in `_outbox`.

### A replica whose schema is behind reads as "every row differs"

The column list exists so a column the **replica** kept and the source dropped cannot
make the two sides disagree. The opposite direction cannot be tolerated the same way:
if the SOURCE has a column the replica lacks, the replica has nowhere to put the value,
so every row's hash differs — for one schema reason, not N data reasons.

`missingColumns` names it, and both callers stop there rather than "repairing": `upsert`
builds its column list from the source row, so it would name a column the replica lacks
and fail on every batch. `verify-replica.js` prints the missing columns instead of
thousands of ids, and pass 3 skips the content repair and logs `schema behind`.
schemaGuard should have halted the worker long before either — this is the second lock
on the same door.

Seen live on 2026-09-08: a counter still on the previous build reported all 405
`UniversalVoucher` and all 35 `Ticket` rows as drifted, because the office had gained
`sourceCounterId` and that replica's schema had not caught up.

### Testing this

```powershell
node test-reconcile.js   # needs TEST_SOURCE_URL and TEST_LOCAL_URL — two empty databases
```

Reproduces every fault above against a throwaway pair of databases — the FK-rewritten
row, the child row edited in place, the replica whose schema is behind, the unpushed
row that is not an upstream delete, the edit stamped behind the cursor, the late
commit, and the cycle killed before its totals were re-summed — and asserts that a key
hash calls each one clean while the new machinery finds it, repairs what is repairable,
holds what this counter still owes the office, and refuses to "repair" a schema gap.
41 checks. The header explains
how to make a scratch cluster from the binaries the app already ships.

### Verifying row contents: `--deep`

`node verify-replica.js --deep` hashes `to_jsonb(row)` instead of the key, for every
strategy, and `--repair` re-pulls whatever disagrees. **Deliberately not on the hourly
schedule**: it reads every row on both sides, and paying that against Supabase is the
egress this project exists to avoid. Reach for it when a counter's screen disagrees
with the office, or after a hard delete on the office.

What it still covers that the hourly pass does not: a `watermark` row whose content
changed while its `updatedAt` did not (the hourly hash covers key + stamp, which is
enough right up until something changes a row without going through Prisma, as cause 1
above did), and `append` tables, which keep a key-only fingerprint. The engine now repairs the known way that happens; `--deep` is how
you check for one nobody has thought of yet.

First full run against a live pair (2026-09-08, 116 tables, 20,748 rows, 23 s):
113 tables exact including contents; `LoyaltyLedger` and `LoyaltyLot` each short two
rows (a key difference the hourly pass repairs on its own); `UserSurfaceSeen` seven
rows diverged in content — which nothing but `--deep` can see.

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

### A delete is announced by the server, and reconciled at once (2026-09-12)

The browser signal cannot help with a delete: it says a *bucket* moved, and the cycle
it wakes pulls by watermark — which, as the reconciliation section says, can never see a
row that is gone. So a delete on the office reached a counter only when that table's
hourly turn in pass 3 came round: every coupon deleted on the web, all eight still on
Counter 94 half an hour later.

Prisma knows what it deleted, so the office server now says so itself. `wrapLive` in
`src/shared/lib/prisma/prismaClient.ts` calls `noteDeleted(model)` after every
successful `delete` / `deleteMany` that reached Supabase — one choke point, because a
counter is refused deletes outright — and `src/shared/lib/realtime/deleteAnnounce.ts`
coalesces those for 300 ms and publishes `{ topics: [], at, deleted: ["Coupon"] }` on
the same channel. Browser tabs drop a signal with no topics (they were already
refreshed by the URL-derived one), so nothing refetches twice. `signal.js` collects
`deleted` across the settle window; `index.js` keeps the names in `pendingVerify` until
the next non-relay cycle and passes `--verify Coupon`; pass 3 in `sync-once.js`
reconciles those tables **first, outside the hourly schedule and the budget** — plus
their registry children and every table with an `ON DELETE CASCADE` foreign key onto
them (`reconcile.referencingCascades`), because the source removed those rows itself
while this replica applies the parent delete with FK actions suspended.

Still a hint: raw SQL, seeds and scripts announce nothing, and a lost broadcast is not
retried — the hourly pass remains the safety net. Model names only travel, never keys;
an unknown name is logged and ignored.

## Verifying the replica

```powershell
node verify-replica.js                  # count + key checksum, every table
node verify-replica.js --keys           # also list differing ids (transfers keys)
node verify-replica.js --deep           # hash the whole ROW, not just the key
node verify-replica.js --deep --repair  # ...and re-pull whatever disagrees
node verify-replica.js --only Person --deep
```

The failure this guards against is silent: a replica missing rows does not error, it
renders a report with fewer lines — which reads as "those records do not exist"
rather than "this database is behind". Cheap enough to run often (two numbers per
table per side; nothing transferred unless a table disagrees).

**A plain run compares keys, not rows** — so it can report a table clean while a row's
contents differ on the two sides. It now says so in its own output rather than
claiming an exact match. `--deep` is what actually proves the contents equal; see
*What a key hash cannot see* above for the two ways rows drift apart in place.

`--repair` never acts on its own: it only fixes what a comparison in the same run
already found.

Last full key run against Supabase: **113 tables, 20134 rows each side, exact match.**
Last `--deep` run (2026-09-08): **116 tables, 20,748 rows, 3 tables disagreeing** — see
above.

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

**Stopping (2026-10-01).** The desktop app asks over IPC (`{ type: "shutdown", graceMs }`,
`electron/syncManager.ts stopSyncWorker`); SIGINT / SIGTERM do the same by hand. A cycle in
flight gets the grace to finish, then the worker ends it and exits — it never leaves one
behind. On Windows a signal from the app is a hard kill that never reached the handler, so
the old "let the cycle finish" left it running as an orphan: still writing after the app
had stopped syncing (before a restore's wipe, too), and still connected when PostgreSQL
was stopped under it. Ending a cycle loses nothing — every page is its own transaction and
the totals it owed wait in `_sync_dirty`. Verified with a source that never answers: asked
mid-cycle with a 2 s grace, the cycle was ended at 2.0 s and the worker exited with it, no
`sync-once` process left.

Verified live: published a `ledger` signal and the service began a cycle 1.3s later.

## Schema drift and readiness

There are no Prisma migrations here (schema is applied with `db push`), so there is
no migration hash to compare. The worker instead compares `information_schema`
column-by-column on both sides, over SQL — no HTTP hop, no endpoint to secure, since
it already holds a connection to each.

**A signal-woken cycle may trust the last check.** `index.js` passes `--reason` to
each cycle. For `signal` and `queued` cycles the worker reuses the verdict in
`_sync_status` when `schema_ok` is true and `last_cycle_at` is within the 10-minute
interval, instead of re-scanning `information_schema` on both sides — one of them on
Supabase — for every keystroke's worth of signals. Startup, interval and retry cycles
always compare, and so does any cycle where that row is missing or says not-ok, so
drift is still caught within one interval.

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

`READ_MODE` decides where READS are served from. `WRITE_MODE` (`live` | `local` | `v_live`) decides
where WRITES land, and picks the client the read dial rides on — a `$transaction` is a
write, so it opens on the WRITE_MODE client and every read inside it stays on the same
database. Both default to `live`.

`WRITE_MODE=v_live` (2026-09-07) is `live` with a relay in front: the app forwards each
write to the office deployment, then asks THIS worker — over the replica itself, with
Postgres NOTIFY — to pull the models that write touched before it answers the browser.
`lib/localSignal.js` holds `LISTEN sync_pull_now`; `index.js` runs
`sync-once.js --only A,B,C --reason relay` at once (no settle window, schema check
trusted, reconcile pass skipped) and reports on `sync_relay_done`. A targeted cycle never
overlaps another cycle, but it does not wait behind one either: a safety-net cycle in
its way is killed (per-table transactions, nothing half-written), the targeted pull
runs, and the interrupted cycle resumes afterwards protected from a second pre-emption,
so a busy till cannot starve it. While the worker is halted on schema drift, targeted
pulls are answered `ok: false` at once, so the app releases the responses it is holding. Channel names
and payloads are fixed on both sides by `src/shared/lib/counter/relayPolicy.ts`.

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
