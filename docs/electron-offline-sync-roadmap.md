# AbeerSuite — Desktop App & Offline-First Sync Roadmap

> **Status honesty note (2026-08-24).** An earlier version of this document described a
> three-tier offline-first desktop app as though it were built. It was not. This rewrite
> separates **what actually ships today** from **what is still a design intention**, so that
> decisions made against this document are made against facts.
>
> **What v0.1.0 actually is:** a hardened Electron kiosk shell that boots the standalone
> Next server on loopback and points a window at it, plus thermal printing and the customer
> QR display through an **external local bridge service on `:9191`**. It reads and writes
> **live Supabase** like the web app does. There is no local database and no sync engine
> running on any counter.

---

## 1. Status at a glance

| Capability | State | Evidence |
|---|---|---|
| Electron shell, single-instance lock, sandboxed renderer | **Built** | [`electron/main.ts`](../electron/main.ts) |
| Standalone Next server on loopback | **Built** | [`electron/serverManager.ts`](../electron/serverManager.ts) |
| Windows installer, symlink hoisting, packaging gate | **Built** | [`scripts/prepare-standalone.ts`](../scripts/prepare-standalone.ts), [`scripts/verify-package.ts`](../scripts/verify-package.ts) |
| Unattended install, baked env allowlist, per-machine `AUTH_SECRET` | **Built** | [`scripts/counterEnv.ts`](../scripts/counterEnv.ts) |
| Silent thermal printing | **Built, but via the `:9191` bridge**, not natively | `PrintToolbar.tsx`, `PosScreen.tsx` |
| Customer QR display | **Built, but via the `:9191` bridge** (serial, COM port) | `qr-display-settings/page.tsx` |
| Dexie UI hot cache | **Built and in real use** | [`src/shared/lib/browser/localDb.ts`](../src/shared/lib/browser/localDb.ts) |
| Supabase realtime broadcast channel | **Built** | [`src/shared/lib/sync/realtimeSync.ts`](../src/shared/lib/sync/realtimeSync.ts) |
| Sync table registry (113 tables) | **Built, generated, precommit-checked** | [`prisma/sync-tables.json`](../prisma/sync-tables.json) |
| Live/local routing + outage demotion | **Built, but dormant** — no local URL is ever set on a counter | [`src/shared/lib/prisma/prismaClient.ts`](../src/shared/lib/prisma/prismaClient.ts) |
| **Embedded / local PostgreSQL** | **NOT SHIPPING** | `resources/pgsql` is empty; `COUNTER_PC` is not in the baked env, so `ensurePostgresRunning()` returns `null` on every counter |
| **Delta sync engine** | **SCAFFOLD ONLY** | `syncTableByNumber()` returns `rowsSynced: 0` without querying; `flushOutboxQueue()` never writes to Supabase; the outbox is an in-process array lost on restart |
| **Local schema bootstrap / migration on first run** | **DOES NOT EXIST** | No `createdb`, no schema apply anywhere in `electron/` |
| **Offline billing** | **NOT AVAILABLE** | Follows from the three rows above |

### Known defects recorded during the 2026-08-24 audit

- **Port 3000 is hard-coded**, and `serverManager.ts` adopts *any* listener on 3000 as its own —
  a running `next dev` gets loaded into the POS window.
- **No splash screen and no loading state.** The window is created only after Postgres and a
  15-second server poll, and is created *even when that poll times out*, producing a permanently
  blank white window with no message.
- **The installer ships `node_modules` twice** — ~646 MB extracted loose via `asarUnpack` that
  nothing at runtime ever loads.
- ~~`refreshReplicaReadiness()` has zero callers~~ — **correction:** it is called from
  `GET /api/counter/status`. It still leaves `replicaReady` permanently `false` today,
  though, because it reads `_sync_status`, a table only the (still-scaffold) sync worker
  writes — see Phase 5.
- **`schemaCheck.ts` has zero callers.**

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
5. **Port and LAN — implemented 2026-08-24.** Each counter now serves itself on **3000 + its
   EPBX extension** (extension "04" -> port 3004), and the server is **bound to the LAN**
   (`0.0.0.0`, not just loopback), on purpose — so any PC on the shop wifi can open a counter
   directly in a browser at `http://<counter-ip>:<port>`, staff login still required. This
   **reopens the LAN-exposure fix** from the 2026-08-24 distribution-hardening pass (which
   bound to `127.0.0.1` specifically to stop that). Per-counter EPBX extension goes in
   `COUNTER_EPBX_EXT`, set per machine in the existing `%APPDATA%/abeersuite-electron/.env`
   override file — see `.env.counter.example`. Also added: GitHub Releases auto-update, via a
   `GH_UPDATE_TOKEN` fine-grained PAT (contents:read only) since the releases repo is private.

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
│  Tier 1: UI Hot Cache (Dexie / IndexedDB)              [BUILT]          │
│  • Instant reads for POS barcode scanner & search                       │
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

## 4. Synchronization strategy (design intention)

### 4.1 Event-driven realtime flow

1. **Local mutation** commits to local PostgreSQL with no network wait.
2. **Outbox** records it durably — this must be a **table in the local database**, not an
   in-process array as the current scaffold uses.
3. **Flush and broadcast** — the worker pushes to Supabase and publishes a small event:
   ```json
   { "n": 12, "ts": "2026-08-23T06:05:00.000Z", "originId": "counter-pos-01" }
   ```
4. **Selective delta pull elsewhere** — other terminals receive the event, filter out their own
   `originId`, map table number `n` through `prisma/sync-tables.json`, and query Supabase for
   **only that table** where `updatedAt >= ts`.

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

- **Durable outbox** drained sequentially on reconnect.
- **Heartbeat catch-up** every 5–10 minutes to cover brief drops.
- **Collision-free IDs** — vouchers are already prefixed by the counter's EPBX extension.
- **Schema drift guard** — `schemaCheck.ts` already exists and works; it must become a
  precondition of syncing rather than dead code.

---

## 5. Desktop & hardware capabilities

| | Today | Target |
|---|---|---|
| Thermal receipt printing | Bridge on `:9191` (`/print/pos`, `/print/payment`) | Electron main process, ESC/POS direct |
| Customer QR display | Bridge on `:9191` (serial, COM port, 921600 baud) | Electron main process via `serialport` |
| COM port enumeration | Bridge `/ports` | Electron IPC |
| Counter/device identity | Bridge `/config` deviceId, minted by the renderer | Electron installation id + stored counter extension |
| Cash drawer kick | Not implemented | Electron main process |
| Auto-update | Built — `electron-updater` against GitHub Releases (private repo, `GH_UPDATE_TOKEN`), but **silent** — `app:update-ready` has no renderer listener | Visible prompt |

---

## 6. Execution roadmap

The active, approved plan is
`~/.claude/plans/127-0-0-1-3000-use-different-port-encapsulated-allen.md`.
Summary of phase order:

- **Phase 0** — make these docs honest. *(this rewrite)*
- **Phase 0.5** — build and install the current code on a clean second machine to surface unknown
  errors early. This install is the baseline every later phase is compared against.
- **Phase 1 — done.** Port and LAN scheme (3000 + EPBX extension, LAN-bound, see decision 5
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
- **Phase 5** — a real sync engine: durable outbox table, an actual `syncTableByNumber()`
  implementation per strategy, worker startup, schema-drift precondition.
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
