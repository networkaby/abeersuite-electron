# AbeerSuite — Desktop App & Offline-First Sync Roadmap

> **Status, 2026-08-26.** The local replica is **built and running**. An earlier version of
> this document described a three-tier offline-first desktop app as though it were built
> when it was not; the 2026-08-24 rewrite corrected that, and this rewrite records that
> most of what it listed as missing has since shipped. What is still open is listed
> honestly at the bottom.
>
> **What ships today:** an Electron shell that bundles **PostgreSQL 17.6**, creates and
> provisions its own local replica on first run, and supervises two child processes — the
> **sync engine** (moved in from the separate counter-sync tool repo) and the **thermal printer bridge**
> (moved in from `combined-bridge`). A counter needs **nothing pre-installed**: no
> PostgreSQL, no Node, no bridge installer, no scheduled task.
>
> Verified in the packaged app from a cold `initdb`: **113/113 tables, 20,136 rows in
> 21.4 s**, `_sync_status.ready = true`, `/staff/login` 200.

---

## 1. Status at a glance

| Capability | State | Evidence |
|---|---|---|
| Electron shell, single-instance lock, sandboxed renderer | **Built** | [`electron/main.ts`](../electron/main.ts) |
| Standalone Next server on loopback | **Built** | [`electron/serverManager.ts`](../electron/serverManager.ts) |
| Windows installer, symlink hoisting, packaging gate | **Built** | [`scripts/prepare-standalone.ts`](../scripts/prepare-standalone.ts), [`scripts/verify-package.ts`](../scripts/verify-package.ts) |
| Unattended install, baked env allowlist, per-machine `AUTH_SECRET` (shared with the office only on a `v_live` build — §4.6) | **Built** | [`scripts/counterEnv.ts`](../scripts/counterEnv.ts) |
| Dexie UI hot cache | **Built and in real use — web/office only; off on a replica-served counter** | [`src/shared/lib/browser/localDb.ts`](../src/shared/lib/browser/localDb.ts) |
| Supabase realtime broadcast channel | **Built** — one channel, `app:changes` | [`src/shared/lib/realtime/appChannel.ts`](../src/shared/lib/realtime/appChannel.ts) |
| Sync table registry (113 tables) | **Built, generated, precommit-checked** | [`prisma/sync-tables.json`](../prisma/sync-tables.json) |
| Live/local routing + outage demotion | **Built** | [`src/shared/lib/prisma/prismaClient.ts`](../src/shared/lib/prisma/prismaClient.ts) |
| **Embedded PostgreSQL** | **BUILT — bundled, 108.8 MB after trim** | [`scripts/fetch-pg.ts`](../scripts/fetch-pg.ts), [`electron/postgresManager.ts`](../electron/postgresManager.ts) |
| **Local schema bootstrap on first run** | **BUILT** — 113 tables / 52 enums from generated DDL | [`scripts/gen-local-schema.ts`](../scripts/gen-local-schema.ts), [`electron/localDbProvisioner.ts`](../electron/localDbProvisioner.ts) |
| **Delta sync engine** | **BUILT** — moved in whole from the separate counter-sync tool repo | [`sync-engine/`](../sync-engine/), [`electron/syncManager.ts`](../electron/syncManager.ts) |
| **`_sync_status` readiness signal** | **BUILT** — written by the engine, read by the app | [`replicaReadiness.ts`](../src/shared/lib/prisma/replicaReadiness.ts) |
| **Thermal printing** | **BUILT, absorbed** — no separate bridge service | [`hardware-bridge/`](../hardware-bridge/), [`electron/hardwareBridgeManager.ts`](../electron/hardwareBridgeManager.ts) |
| **Native modules under Electron** | **No rebuild needed** — `sharp` and `serialport` are N-API | verified under `ELECTRON_RUN_AS_NODE` at ABI 148 |
| Customer QR display | **BUILT, absorbed** — `:9192` now served in-app | [`hardware-bridge/qr.js`](../hardware-bridge/qr.js) |
| **Offline billing / writes** | **BUILT** — id-range reservation, first-launch setup, write gate, outbox | `idRange.ts`, `applyIdRanges.ts`, `/setup/counter`, `createLocal()`, `/api/sync/push`; see §6 |
| Offline Policies settings page | **BUILT** — one DB row, enforced in the replica write guard | [`OfflinePolicy`](../prisma/schema/org.prisma), [`offlinePoliciesServer.ts`](../src/shared/lib/accountancy/offlinePoliciesServer.ts), [`offlinePolicyTargets.ts`](../src/shared/lib/accountancy/offlinePolicyTargets.ts) |

### Defects fixed in the 2026-08-26 pass

- `initdb` built a cluster but **nothing ever created the `smx` database**.
- A bare `CREATE DATABASE` inherited the **Windows collation**, which silently changes
  text sort order versus live — no error, no checksum mismatch, just reports that
  disagree with the office.
- **A listening port is not readiness.** PostgreSQL accepts connections ~600 ms after it
  binds; the old check landed inside that window every time.
- The bundled workers could not **resolve their own dependencies** on a customer machine
  (resolution walked up into the dev repo and appeared to work).
- electron-builder **dropped `node_modules`** from `extraResources`.
- The dependency hoist **aborted a whole build** on a transient Windows file lock.

### Defects fixed in the 2026-08-27 pass

- **`local-schema.sql` re-apply was not idempotent, and crashed on the first collision.**
  `localDbProvisioner.ts` re-runs the bundled schema on every app upgrade that changes
  it (its `schema_hash` check) and after any interrupted first-run attempt — both
  re-apply against a database that already has some or all of the objects. Reproduced
  live: an upgrade hit `type "TierCurrentSaleScope" already exists`, `COUNTER_PC` never
  got set, and the counter silently stayed live-only forever after — no badge, no local
  reads, no error visible anywhere but the log. `scripts/gen-local-schema.ts` now
  post-processes the generated DDL into an idempotent form (`CREATE TABLE`/`CREATE
  INDEX` gain `IF NOT EXISTS`; `CREATE TYPE`/`ADD CONSTRAINT` are wrapped in a `DO`
  block swallowing `duplicate_object`), verified by applying the new file twice against
  a real counter's already-broken `pgdata`.
- **A column added to an existing table never reached an already-provisioned replica.**
  The schema file is a full from-empty snapshot, so `pos_counters` gaining
  `counterNumber` showed up as that table's `CREATE TABLE` gaining a column — which
  `IF NOT EXISTS` then skipped entirely, since the table already existed. Reproduced
  live as `column "counterNumber" does not exist`. `gen-local-schema.ts` now also
  emits `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every column right after its
  table, closing the common case (new nullable/defaulted column). A dropped/renamed/
  retyped column, or a new `NOT NULL` column with no default on a populated table, is
  not expressible as an additive `ALTER` and still fails loudly — deliberately not
  silently patched over. A real diff-against-target migrator would close that
  remaining gap and is separate work.

### Known defects still open

- **Port 3000 is hard-coded** in `serverManager.ts`'s adoption check — a running
  `next dev` can be adopted into the POS window. (The serving port itself is 786.)
- **The installer ships `node_modules` twice** — the 2026-08-24 size audit measured
  ~646 MB extracted loose that nothing at runtime loads.
- ~~`schemaCheck.ts` has zero callers~~ — deleted 2026-09-03; the sync engine's own
  `schemaGuard.js` is the guard and does halt on drift.

---

## 2. Owner decisions (2026-08-24)

These fix the direction that was previously unstated.

1. **Bridge retirement is step by step.** Counter identity moves into Electron first. Printing and
   the QR display keep using `:9191` for now and are retired one at a time later. The serial work
   needs a native module (`serialport`) and is deliberately not bundled into the first change.
2. **PostgreSQL is auto-detected at first run — no installer prompt.** The install stays 100%
   unattended. The app must then **display which server it selected** (an existing install on
   5432, or the embedded one on 54329) so the choice is never invisible.
3. **Releases ship two installers**: a small `nsis-web` stub that downloads its payload, plus a
   full offline `.exe` for machines with poor internet.
4. **Local database readiness is lazy.** The app starts in live mode and is immediately usable;
   the replica is prepared in the background the first time the machine is online. It never
   blocks a cashier.
5. **Port and LAN — implemented 2026-08-24, port scheme superseded 2026-08-26.** The server is
   **bound to the LAN** (`0.0.0.0`, not just loopback), on purpose — so any PC on the shop wifi
   can open a counter directly in a browser at `http://<counter-ip>:786`, staff login still
   required. This **reopens the LAN-exposure fix** from the 2026-08-24 distribution-hardening
   pass (which bound to `127.0.0.1` specifically to stop that).
   ~~Each counter served itself on 3000 + its EPBX extension (extension "04" -> port 3004),
   read from `COUNTER_EPBX_EXT`.~~ Replaced 2026-08-26: every counter now binds the same
   **fixed port, 786** — the derivation assumed a 1–2 digit extension, which doesn't match
   real EPBX extensions here (e.g. `0786`), and per-counter uniqueness was never actually
   needed since each counter is its own PC with its own IP (the IP disambiguates on the LAN,
   not the port). `COUNTER_EPBX_EXT` still exists for whatever reads `PosCounter.epbxExtension`
   directly; it just no longer feeds port selection. Also added: GitHub Releases auto-update,
   via a fine-grained PAT (contents:read only) since the releases repo is private.
6. **Auto-update repo split off the source repo, and made configurable — implemented
   2026-08-24.** Updates point at a **separate private repo**,
   `devloperakramul/abeersuite-networkservice-update` — release artifacts only, no source.
   Both `PAT_TOKEN` and `GITHUB_UPDATE_REPO` (`"owner/repo"`) are baked into every counter's
   `counter.env` (`scripts/counterEnv.ts`) rather than the repo being hard-coded in
   `electron/main.ts` — a leaked installer therefore exposes at most the release artifacts
   every counter already has on disk, never the private codebase.
   The publish-side token (`GH_TOKEN`, write access) is a separate, more powerful credential
   that stays in the build machine's own `.env` only and must never be added to
   `COUNTER_ENV_COPIED`. `pnpm electron:release` runs it: `electron:pack` (build,
   `electron-builder --dir`, `verify:package`) must pass first, and only then does
   [`scripts/release-electron.ts`](../scripts/release-electron.ts) pack and publish that
   *exact* verified `dist-app/win-unpacked` tree via `--prepackaged` — never a fresh rebuild,
   so there is no window where an unverified build could reach the public release.

### Counter identity — corrected

The counter number is **not** random and is not being replaced. Every counter has an **EPBX
extension** (`PosCounter.epbxExtension`), admin-edited, and it already supplies the voucher prefix
in [`voucherRef.ts`](../src/modules/accountancy/lib/voucherRef.ts). That stays exactly as it is.

What changes is only the *machine binding* — today a UUID minted by the renderer and stored in the
`:9191` bridge's config. That moves onto Electron's own installation id, and the PC additionally
remembers which counter it is (id + extension) so staff see "Ext 04" rather than a UUID.

---

## 3. Target architecture (design intention, not current state)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AbeerSuite Desktop                             │
│                                                                         │
│  Tier 1: UI Hot Cache (Dexie / IndexedDB)     [BUILT — web/office only] │
│  • Instant reads for POS barcode scanner & search                       │
│  • RETIRED on a counter served by its own replica: Tier 2 is already    │
│    local, so this tier saves nothing and only risks a stale stamp       │
│                                    ▲                                    │
│  Tier 2: Primary Local Store (Local PostgreSQL)        [NOT BUILT]      │
│  • Schema parity with cloud Supabase (enums, arrays, JSONB)             │
│  • Local ACID double-entry transactions and reports                     │
│                                    ▲                                    │
│                                    │ Background Sync Worker [SCAFFOLD]  │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │ WebSockets (Realtime) + HTTP (Delta)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 3: Cloud Central Store (Supabase PostgreSQL)      [BUILT, IN USE]  │
│ • Today this is the ONLY store a counter reads or writes                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Why PostgreSQL and not SQLite

Unchanged and still correct: the schema uses PostgreSQL-specific features (`tags String[]`,
native `enum`, `@db.Date`, check constraints), so a local PostgreSQL means **zero dialect
translation** against the existing 113-table registry.

Two facts that were previously glossed over:

- The project applies schema with **`prisma db push` and keeps no migrations directory**
  (see [`scripts/gen-sync-registry.ts`](../scripts/gen-sync-registry.ts)). First-run local
  readiness therefore needs a **programmatic schema apply**, not a migration runner.
- `initdb` alone is not enough. It creates an empty cluster with **no database and no schema**.
  The current code publishes a connection string pointing at a database that does not exist.

---

## 4. Synchronization strategy (as built, 2026-09-03)

### 4.1 Event-driven realtime flow

The signal vocabulary is **topics**, not table numbers — eight coarse buckets in
[`src/shared/lib/realtime/topics.ts`](../src/shared/lib/realtime/topics.ts), published on
one Supabase Realtime channel (`app:changes`) as `{ topics, at }` and never a row. A signal
always means **"the rows are in Supabase now"**; correctness never depends on it (watermarks
and reconcile run regardless), it only makes things happen sooner.

1. **Local mutation** commits to the counter's PostgreSQL (`WRITE_MODE=local`). The
   `_outbox_capture` trigger records it in `_outbox` in the same transaction and ends with
   `pg_notify('outbox_changed')`, delivered only at commit.
2. **Push** — the in-process flusher ([`flusher.ts`](../src/shared/lib/sync/flusher.ts))
   holds `LISTEN outbox_changed`, pushes the batch through Prisma to Supabase, and only
   after `markOutboxPushed` retires a non-empty batch does it publish `ALL_TOPICS`. The
   counter's own browser stays silent under `WRITE_MODE=local` (`setWritesGoLocal`), so
   nothing announces before Supabase holds the row.
3. **Other writers announce themselves too.** A browser on Vercel or `WRITE_MODE=live`
   publishes from the axios response interceptor (after the server's commit). Writes with
   no browser behind them call `publishChangeServer` after their DB work returns: the
   epbx bridge (`/api/calls`), the payment callbacks (Razorpay, PayU) and the courier
   webhooks (Shiprocket, Shipway).
4. **Pull** — every counter's `sync-engine` hears the signal, settles 750 ms, and runs a
   cycle (four tables at a time, schema guard trusted from the last full check). When a
   cycle actually wrote rows it prints `__SYNC_APPLIED__`, which `syncManager.ts` forwards
   to every window as `sync:applied`.
5. **Screens** — `useRealtimeTopics(topics, reload)` re-reads after a 600 ms settle. On a
   counter that reads its replica (`READ_MODE` local/shadow) the hook ignores the early
   Supabase signal and waits for `sync:applied`, so it refetches once, after the rows have
   landed, never a stale read first. A server-rendered page uses
   [`LiveRefresh`](../src/shared/components/LiveRefresh.tsx), which calls `router.refresh()`
   on the same hook.

   **Where it is subscribed matters.** Prefer the shared component or hook that owns the
   read over the pages that render it: one line in `InvVoucherList` makes 14 voucher
   registers live, `GlVoucherList` 5, `BookPage` the cash/bank/loan books, and the line in
   `useDayBook` covers both the Day Book and the "All" register. A page adds its own line
   only when it owns its own fetch.

   **Two rules every subscriber follows:**

   - **Silent re-read.** A live update must not blank a screen someone is reading, so the
     reload takes a `silent` flag that skips the spinner; the Refresh button keeps it.
     Beware `onClick={load}` — React passes the MouseEvent as that first parameter, which
     is what silently disabled Refresh on twelve reports in 2026-08-22. Write
     `onClick={() => load()}`.
   - **Editors do not subscribe.** A voucher detail/new screen, the opening-balance sheet,
     the GST classification grid and the storefront layout designer all hold input the user
     is part-way through; refetching under the cursor would discard it. These stay
     fetch-once on purpose, as do Settings, Admin, BI and Pricing-strategy by owner
     decision (BI pages are heavy aggregates), and the customer-facing shop/portal, which
     is server-rendered.

   As of 2026-09-04, 120 of 258 routes are live. The rest are the deliberate exclusions
   above plus print-once pages (receipts, shipping labels, slips) and static menus.

### 4.2 Table strategies — actual registry contents

113 tables, numbers append-only, generated by `scripts/gen-sync-registry.ts` and kept honest by
`pnpm sync:tables:check` in `precommit`:

| Strategy | Count | Behaviour |
|---|---|---|
| `watermark` | 47 | Delta pull on `updatedAt`, upsert by primary key |
| `child` | 35 | Full child set replaced when the parent updates |
| `full` | 22 | Tiny master tables refreshed on version change |
| `append` | 9 | Insert-only ledgers and audit logs |

### 4.3 Offline resilience

- **Durable outbox** drained in `_outbox.id` order on reconnect, stopping at the first
  failure; a stuck row backs off and is dead-lettered so the queue behind it moves.
- **Interval catch-up** every 10 minutes (worker) and 60 s (flusher) as safety nets for
  writes that emitted no signal — scripts, seeds, a restore.
- **Collision-free IDs** — per-counter autoincrement ranges applied at setup
  (`_apply_id_range`), gating every local write.
- **Schema drift guard** — `sync-engine/lib/schemaGuard.js` compares `information_schema`
  on both sides and halts the cycle (exit 4) on a missing or retyped column.

### 4.4 Running totals never travel (2026-09-05)

`Account.balance`, `InvProduct.stock` / `InvProductBranch.stock` and `GiftCard.balance`
are caches kept by increments. Shipped as row images under last-write-wins, two machines
adding to the same total from the value each last pulled overwrote each other's
increments. The rule now: **a running total is never sent on an update; each side re-sums
it from its own ledger after ledger rows land.** One list, `cacheColumns` in
`prisma/sync-tables.json` (`overrides`), drives all three places: the capture trigger
ships no outbox row when only a total (and `updatedAt`) changed; `push.ts` leaves the
columns out of the UPDATE half of its upsert and re-sums the touched accounts / products /
gift cards on Supabase after the flush (`rebuildTotals.ts`); the engine does the same on
the replica in pass 4 of every cycle (`sync-engine/lib/rebuildTotals.js`). Totals still
ride a row's CREATE (the columns are NOT NULL). `verify-replica.js --totals` proves each
side against its own ledger; `pnpm recompute:caches` is the one-shot repair.

Voucher numbers are the one total that is an allocator, not a sum: they live per
`(kind, counterNumber)` in `VoucherSeriesCounter`, and only the machine numbering on a
row writes it. The office is counter 1; a PC cannot take number 1. The table carries
`localAuthority` in the registry `overrides`: the reconcile pass never deletes from it,
because a counter's own row absent upstream is not an office delete — it is a row the
cloud has not seen yet, and losing it restarts the series from 1 on bills already
printed. The same flag makes `push.ts` never drop such a row as "superseded" by a
newer cloud copy. And the office's "Reset Counter" never writes another machine's row:
it bumps `VoucherSeries.resetGen`, and each counter zeroes its own row the next time it
numbers (2026-09-14). The same pass holds back any row still pending in `_outbox`, for every table
(`sync-engine/lib/outboxGuard.js`; see `sync-engine/README.md`).

Gift cards are the residual: a single till cannot overdraw a card (conditional draw), but
two tills apart can each spend the same card. After the rebuild the balance is negative,
`/api/sync/status` reports `overdrawnGiftCards`, the badge and title show it, and the
card refuses further draws until an admin posts an ADJUST txn.

### 4.5 Restoring a backup stops everything that writes, then restarts the app (2026-09-05)

A restore replaces Supabase, and three things on the till kept writing straight through
one — each of them undoing it:

1. **The sync worker** pulls Supabase into the replica. `stopSyncWorker()` sends SIGTERM
   and returns; `sync-engine/index.js` deliberately lets a cycle already in flight
   finish, so stopping the scheduler alone is not enough.
2. **The outbox flusher** pushes the till's pending writes UP. It lives inside the forked
   Next server (`instrumentation.ts`) and main has no channel to it, so within the minute
   it pushed pre-restore rows back over the restore.
3. **The replica** keeps the pre-restore values for ever: restored rows carry an *older*
   `updatedAt` than the watermark, and the pull's last-write-wins guard refuses them.

`backup:restore-from-disk` now stops the worker, restores, wipes the replica
(`wipeReplica` — rows, `_outbox` and `_sync_state` together) and calls
`app.relaunch()` + `app.quit()`. The relaunch is what answers all three: `will-quit`
stops the Next server and takes the flusher and any in-flight sync child with it, and the
next boot sees a never-synced replica and pulls the restored database in full with the
readiness gate closed until it has. A restore that FAILS restarts the worker and changes
nothing else.

The wipe discards `_outbox`, which is real work, so the card names the number first:
`countPendingOutbox()` rides on `backup:availability` and the restore panel and its
confirm dialog both say how many writes this till will lose. They also say the PC
restarts by itself, and that **every other counter must be released and onboarded
again** — their replicas hold rows newer than the backup and will never pull the restored
figures on their own. The hourly key-reconcile eventually removes rows the restore
deleted and pulls rows it added, but a row whose *values* were rolled back keeps the
newer local `updatedAt` and is never repaired.

Still open (audit D1): the restore itself runs `pg_restore --clean --jobs=4` through the
pgBouncer *transaction* pooler on a packaged counter, because `DIRECT_URL` is excluded
from `counter.env`.

---

### 4.6 Relayed writes — `WRITE_MODE=v_live` (2026-09-07)

A third write mode for the trial till. The counter's own Next server forwards every
non-GET `/api/*` call to the office deployment (`WRITE_API_URL`) as one HTTP round trip —
[`writeRelay.ts`](../src/shared/lib/counter/writeRelay.ts), called from `src/proxy.ts` —
while reads stay on the replica. Below the relay the mode is `live`, so an unreachable
office means the request runs here with `live`'s existing outage fallback. Three rules:

1. **Fall back only when nothing was sent.** DNS, refused, TLS or the 2 s connect timeout
   → run locally. Any failure after the connection is up → `502 relay_uncertain`, never a
   local retry, because that would mint the bill twice under two numbers. An office HTTP
   error passes straight through — except a gateway `502`–`504` with no JSON body, which
   is answered as uncertain too, and a bare `401` (the cookie did not decode at the
   office), which pauses the relay for 60 s and runs locally; a `SESSION_REVOKED` `401`
   passes through and signs the cashier out.
2. **Hold the response until the replica has the rows.** On an office 2xx the relay asks
   the worker for a targeted pull over Postgres NOTIFY (`sync-engine/lib/localSignal.js`)
   and waits, bounded at 3 s, for `sync_relay_done`. Screens then refetch from a replica
   that already holds the save; a timeout falls back to the Realtime path above. A
   safety-net cycle in the way is stepped aside and resumed afterwards, and routes that
   add a shift's children (Rcv, Exp, cash drop, the sale's surplus receipt) bump the
   shift row so those `child` tables ride the same pull.
3. **Every write is forwarded.** There is no segment allowlist: any non-GET `/api/*`
   call goes to the office, minus this machine's own routes (`auth`, `counter`, `health`,
   `sync`, `pos/counters`, backup/restore) and bodies over 4 MB. A full build running in
   counter mode serves routes the counter build strips, and their writes must reach the
   office too — the till never writes Supabase directly while the office is reachable.

The office authenticates the relayed request from the till's own session cookie: the
cookie NAME is pinned in `src/auth.ts` (Auth.js keys the token on secret + name) and
`counter.env` ships the office's `AUTH_SECRET` for this mode only. Anything saved at the
office, a relayed POS sale included, numbers in the common series (counter 1).

## 5. Desktop & hardware capabilities

| | Today | Target |
|---|---|---|
| Thermal receipt printing | Bridge on `:9191` (`/print/pos`, `/print/payment`) | Electron main process, ESC/POS direct |
| Customer QR display | Bridge on `:9191` (serial, COM port, 921600 baud) | Electron main process via `serialport` |
| COM port enumeration | Bridge `/ports` | Electron IPC |
| Counter/device identity | Bridge `/config` deviceId, minted by the renderer | Electron installation id + stored counter extension |
| Cash drawer kick | Not implemented | Electron main process |
| Auto-update | Built — `electron-updater` against a separate private releases-only repo (`GITHUB_DOWNLOAD_UPDATE_REPO` + `_PAT_TOKEN`, both baked), visible prompt, installs at a safe moment (`electron/updateManager.ts`, 2026-09-03). **Blocked on the feed repo existing** — the baked repo answers 404 | Owner creates/grants the releases-only repo; then a real release round-trip |

---

## 6. Execution roadmap

The active, approved plan is
`~/.claude/plans/127-0-0-1-3000-use-different-port-encapsulated-allen.md`.
Summary of phase order:

- **Phase 0** — make these docs honest. *(this rewrite)*
- **Phase 0.5** — build and install the current code on a clean second machine to surface unknown
  errors early. This install is the baseline every later phase is compared against.
- **Phase 1 — done.** Port and LAN scheme (now a fixed port, 786, LAN-bound — see decision 5
  above); the adopt-existing-listener branch in `serverManager.ts` is deleted; the app shows a
  local splash immediately (`show: false` + `backgroundColor` + `ready-to-show`, no blank white
  frame), pushes boot progress to it over IPC, and falls through to a real error page naming the
  session's log file (`%APPDATA%/abeersuite-electron/logs/main.log`) instead of silently loading
  a dead window when the server never becomes ready.
- **Phase 2 — done.** `src/shared/lib/counter/identity.ts` resolves this PC's identity —
  Electron's installation id when available, else the bridge's deviceId — and
  `ShiftOpenDialog`, `useMyCounterExtension`, and printer-settings' parked "Counter lock"
  card all match against it. The server (`POST /api/pos/shifts`) accepts an optional
  `legacyDeviceId` alongside `deviceId`: a counter bound under the old bridge id is
  recognised and silently rebound to the canonical Electron id rather than refused.
  `epbxExtension` and the voucher prefix are untouched. Printing and QR still use `:9191`.
- **Phase 3 — mostly done.** `resources/` measured **467.9 MB, verified**, down from 1,436.0 MB
  (67% smaller) — `scripts/lib/hoistNodeModules.ts` (factored out of `prepare-standalone.ts` for
  reuse) added a `denylist` that prunes `prisma`/`typescript`/`playwright`/`playwright-core`/
  `fast-check`/`@babel/*` (build-only tools reachable through the pnpm store walk but never
  `require()`d at runtime) and strips `.d.ts`/`.map` from everything else. The real fix for the
  duplication: `dist-electron/main.js` has exactly two runtime `require`s outside Node builtins
  (`dotenv`, `electron-updater`) — `scripts/prepare-electron-deps.ts` hoists just those two (+ 15
  transitive deps) into `dist-electron/node_modules`, letting `package.json`'s `files` exclude the
  top-level `node_modules` entirely instead of electron-builder bundling the *whole* project's
  "dependencies" (which mixes the Next app's deps with the Electron shell's) a second time.
  `compression: "maximum"` and `electronLanguages: ["en-US"]` added; `verify-package.ts` gained a
  size-ceiling check (800 MB) so this cannot regress silently. Verified live: rebuilt, launched the
  packaged app on the baked `counter.env` alone (no `%APPDATA%` override), confirmed boot,
  `/staff/login` 200, and clean shutdown with no orphan process.
  **Not done:** the `nsis-web` target needs a hosting decision for `appPackageUrl` (GitHub Releases
  is the candidate) — still open, see below.
- **Phase 4 — detection half done; provisioning deferred.** `electron/postgresManager.ts`:
  the `COUNTER_PC=1` hard gate is now a persisted per-machine setting (`userData/replica.json`,
  defaults enabled, env override kept for testing); detecting an existing install on 5432 no
  longer requires the embedded binaries to be bundled at all; both the installed and embedded
  paths now do a real `SELECT 1` (via `pg`, added to `prepare-electron-deps.ts`'s hoisted
  set) instead of trusting a listening port. `electron/main.ts` sets `COUNTER_PC=1`
  dynamically, from the actual detection result, before forking the Next server — the
  read-routing in `prismaClient.ts`/`counterMode.ts` gates on that flag, not on
  `LOCAL_DATABASE_URL`'s mere presence, so without this the rest of the plumbing would never
  activate even with a real database found. `counterStatus()` and the shell badge
  ([`CounterStatusBadge.tsx`](../src/shared/components/CounterStatusBadge.tsx)) now report
  `replicaSource: "installed" | "embedded" | null`.
  **Deferred, not implemented:** downloading the embedded PostgreSQL binary and applying the
  schema (`createdb` + `prisma db push`) programmatically. Both need real infrastructure this
  environment does not have — internet access to fetch a ~90 MB binary, and a real PostgreSQL
  instance to push a schema into and verify against — so writing that code now would be
  untested guesswork shipped as if it worked. `resources/pgsql` stays empty; a counter with no
  installed PostgreSQL stays in live mode, exactly as today.
- **Phase 5 — deliberately not attempted this pass.** Same reasoning as Phase 4's deferred
  binary/schema work, more acute here: syncing data *into* a local database cannot be built
  responsibly without one to sync into and diff against, and none exists in this environment
  or on any counter today (Phase 4 left `resources/pgsql` empty on purpose). Writing
  `syncTableByNumber()`'s delta-pull/upsert logic, a durable outbox, or worker startup with
  no way to run a real cycle and confirm rows actually land correctly would be exactly the
  untested-guesswork risk this pass has avoided everywhere else. One specific finding worth
  recording: fixing `useRealtimeTopics.ts`'s over-fire (Check A3 in the original audit — it
  reacts to *any* sync event, ignoring the topic filter the app-channel path applies) turned
  out to need a table-number -> `Topic` mapping that does not exist anywhere yet; that mapping
  is itself sync-engine design work, not a standalone bug fix, so it stays open here rather
  than being hacked in blind. In practice this has near-zero effect today: `broadcastTableMutation`
  is only ever called from the outbox's stub flush, which nothing populates. Do this phase
  once Phase 4's local database actually exists to test against.
  **Superseded, 2026-08-27**: local Postgres provisioning shipped (`electron/localDbProvisioner.ts`
  applies `resources/local-schema.sql`, creates the `smx_sync`/`smx_app` roles) and the delta-pull
  sync engine was absorbed whole (`sync-engine/`, `electron/syncManager.ts`) — both well before
  this note was corrected, which this doc had not caught up to. On top of that, this pass built
  the missing offline-**write** half end to end: per-counter id-range reservation
  (`src/shared/lib/counter/idRange.ts`), a first-launch setup screen (`/setup/counter`) that
  claims a counter number and applies the range before anything can bill, a confirmed-range write
  gate in `createLocal()` (an unconfirmed range now refuses the write, not silently proceeds
  unprotected), a real durable outbox (`enqueueOutbox()` now has callers — it had none before this
  pass, so nothing had ever reached `_outbox`), and `/api/sync/push` rewritten on Prisma's typed
  client (the previous raw-SQL version had a column-name injection hole and an allowlist of table
  names that didn't match 10 of its 14 real tables — neither had ever been exercised). Last-write-
  wins was also added for offline edits, on both the pull (`sync-engine/lib/pull.js`) and push
  sides.
  **Closed, 2026-09-01**: the `useRealtimeTopics.ts` over-fire is gone, and the table-number ->
  `Topic` mapping it was waiting on was never needed. The sync-event channel it over-fired on
  (`abeersuite:sync-events`) had no publisher at all — `broadcastTableMutation` had zero callers
  and the outbox stub that was supposed to call it had been replaced by the real durable outbox,
  which pushes over `/api/sync/push` and does not broadcast. The channel was deleted rather than
  filtered: it also opened a socket per TAB, outside the tab-leader election. `useRealtimeTopics`
  now listens only to `app:changes`, where the topic filter it was accused of ignoring has always
  been applied.
- **Phase 6 — done.** [`scripts/counterEnv.ts`](../scripts/counterEnv.ts)'s `COUNTER_ENV_COPIED`
  no longer includes the 4 `DROPBOX_*` / 3 `GITHUB_*` keys (commented out, not deleted, so
  re-enabling for a specific release is a one-line uncomment). `resources/counter.env` now
  ships **8 keys**, down from 15. Zero other code change: `backupAvailability()` already
  reported `canBackup`/`canRestore` from key presence alone, and every backup/restore route
  already rendered the counter-only 503 shape — verified via `verify-package.ts`, which
  derives its allowlist from the same source and passed against the already-packaged tree.

**UX guarantee applied throughout:** the web app stays the default path, and every desktop
capability degrades to today's behaviour when it is absent or fails.

---

## 7. Still open (not code)

The ~60 credentials shipped in plaintext inside the two already-built 0.1.0 installers must be
**rotated**. Internal-only distribution changes who may hold them; it does not change the fact
that a plaintext copy left the build machine.
