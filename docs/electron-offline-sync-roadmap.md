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
- **`refreshReplicaReadiness()` has zero callers**, so `replicaReady` is permanently `false`.
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
- **Phase 1** — port and LAN scheme **done** (3000 + EPBX extension, LAN-bound, see decision 5
  above); still to do: delete the adopt-existing-listener branch in `serverManager.ts`, add a
  splash screen, progress text, and a real error page so a cold start is never blank.
- **Phase 2** — counter identity into Electron, with a rebind path so machines already bound to a
  bridge deviceId are not locked out. Printing and QR untouched.
- **Phase 3** — installer size and speed: stop shipping `node_modules` twice, prune dev packages
  from the standalone tree, max compression, trim locales, add the `nsis-web` target.
- **Phase 4** — local PostgreSQL: real detection, database creation, programmatic schema apply,
  lazy background readiness, and a UI that names which server was chosen.
- **Phase 5** — a real sync engine: durable outbox table, an actual `syncTableByNumber()`
  implementation per strategy, worker startup, schema-drift precondition.
- **Phase 6** — make Dropbox/GitHub backup dormant per release by dropping its keys from the
  baked env allowlist.

**UX guarantee applied throughout:** the web app stays the default path, and every desktop
capability degrades to today's behaviour when it is absent or fails.

---

## 7. Still open (not code)

The ~60 credentials shipped in plaintext inside the two already-built 0.1.0 installers must be
**rotated**. Internal-only distribution changes who may hold them; it does not change the fact
that a plaintext copy left the build machine.
