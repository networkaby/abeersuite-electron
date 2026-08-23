# AbeerSuite — Desktop App & Offline-First Sync Roadmap

This document outlines the complete architectural decisions, data flow, and phased execution roadmap to convert **AbeerSuite** into a high-performance, offline-first desktop application using **Electron**, **Embedded/Local PostgreSQL**, **Dexie (IndexedDB)**, and **Supabase Realtime Selective Delta Sync**.

---

## 1. Core Architecture Decisions

### 1.1. Three-Tier Offline-First Data Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AbeerSuite Desktop                             │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Tier 1: UI Hot Cache (Dexie / IndexedDB)                         │  │
│  │ • Instant < 0.1ms read latency for POS barcode scanner & search   │  │
│  │ • Unsaved cart drafts & active cash counter session state         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                    │
│                                    │ Async UI flush & hydration         │
│                                    ▼                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Tier 2: Primary Local Store (Embedded / Local PostgreSQL)        │  │
│  │ • 100% schema parity with cloud Supabase (enums, arrays, JSONB)   │  │
│  │ • Full ACID double-entry accounting transactions & local reports  │  │
│  │ • Zero internet required for billing, stock ledger, or audits     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                    │
│                                    │ Background Sync Worker             │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
                                     │ WebSockets (Realtime) + HTTP (Delta)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 3: Cloud Central Store (Supabase PostgreSQL)                       │
│ • Central source of truth for multi-branch sync & owner mobile view     │
│ • Realtime Broadcast Channel for instant table update events            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2. Database Engine: Embedded PostgreSQL
- **Decision**: Use **Embedded / Local PostgreSQL** rather than SQLite.
- **Why**:
  - Full native support for PostgreSQL-specific schema features used in AbeerSuite (`tags String[]`, native `enum`, `@db.Date`, check constraints).
  - Uses the existing `prisma/sync-tables.json` registry with zero dialect translation overhead.
  - Multi-terminal LAN ready: one counter PC can act as the local master database for other tablets/counters in the shop.
- **Installer experience**: Embedded binary runs portable with zero manual configuration for single-store users.

---

## 2. Synchronization Strategy (Event-Driven Selective Delta Sync)

To keep cloud read costs to the absolute minimum and achieve sub-second synchronization between terminals:

### 2.1. Event-Driven Realtime Flow
1. **Local Mutation**: A user writes a transaction (e.g. POS voucher, product update) locally.
2. **Local Commit & Queue**: The change commits to Local PostgreSQL with 0ms delay.
3. **Outbox Flush & Broadcast**:
   - The sync worker pushes the change to Cloud Supabase.
   - A lightweight event is published over the Supabase Realtime channel:
     ```json
     {
       "n": 12,
       "ts": "2026-08-23T06:05:00.000Z",
       "originId": "counter-pos-01"
     }
     ```
4. **Selective Delta Pull on Other Terminals**:
   - Other running apps/terminals receive the event over WebSocket.
   - The app filters out its own `originId`.
   - The app reads table number `n` (mapped via `prisma/sync-tables.json`) and queries Supabase **only for table #12** where `updatedAt >= ts`.
   - Updated rows are upserted into the receiving terminal's Local PostgreSQL and Dexie UI cache.

### 2.2. Table Sync Strategies (from `prisma/sync-tables.json`)
- **`watermark`**: Tables with `@updatedAt` (e.g., `Person`, `Company`, `Product`). Delta pull and upsert by primary key.
- **`child`**: Dependent sets with cascading parent (e.g., voucher items). Full child set replaced when parent updates.
- **`append`**: Append-only ledgers and audit logs (e.g., ledger lines, ticket logs). Insert-only sync.
- **`full`**: Tiny master tables (e.g., tax slabs, payment methods). Refreshed on version change.

### 2.3. Offline Resilience & Safety Net
- **Outbox Pattern**: Changes made while offline are saved to a local `_sync_outbox` table and drained sequentially upon network reconnection.
- **Heartbeat Catch-Up**: A low-frequency fallback check (every 5–10 minutes) ensures no table updates were missed during brief connection drops.
- **Collision-Free IDs**: Transactions use branch-prefixed sequences or UUIDs to prevent ID collisions between offline terminals.

---

## 3. Desktop & Hardware Capabilities

1. **Silent Thermal Printing (POS)**:
   - Electron Main Process connects directly to ESC/POS thermal receipt printers via USB/Serial/Network.
   - Bypasses browser print dialog for instant, one-click receipt issuance.
2. **Barcode Scanner & Cash Drawer**:
   - Dedicated raw USB/serial input listeners for cash drawer kick on cash payment confirmation.
3. **Window Management & Lifecycle**:
   - Kiosk / full-screen POS mode support.
   - Auto-updater integration for background app updates.

---

## 4. Packages & Dependency Audit

### Packages to Add
- `electron`: Core desktop runtime.
- `electron-builder`: Windows/macOS/Linux installer and packaging.
- `node-thermal-printer` / `@node-escpos/core`: Direct receipt printing without OS dialog.
- `wait-on`, `concurrently`, `cross-env`: Developer lifecycle and concurrent runner scripts.

### Optimizations
- Keep Dexie for hot UI cache.
- Trim cloud-only web redirects and unnecessary client-side polling loops.
- Use local loopback (`http://127.0.0.1`) with optimized header/body parsing for local IPC and API server.

---

## 5. Step-by-Step Conversion Roadmap

### Phase 1: Electron Foundation & Project Structure
- [ ] Initialize Electron directory structure (`electron/main.ts`, `electron/preload.ts`).
- [ ] Configure `electron-builder.json` with packaging rules and Windows targets (NSIS).
- [ ] Setup development scripts in `package.json` (`electron:dev`, `electron:build`, `electron:pack`).
- [ ] Implement secure IPC bridge for window controls, network status, and hardware.

### Phase 2: Embedded Database & Local Engine Setup
- [ ] Configure Local PostgreSQL embedded lifecycle in Electron main process.
- [ ] Setup dynamic database connection handling in `src/shared/lib/prisma/prismaClient.ts` (routing between local replica and live).
- [ ] Create initial local database bootstrap & migration runner on first app launch.

### Phase 3: Event-Driven Selective Delta Sync Engine
- [ ] Setup Supabase Realtime channel subscription for broadcast events (`{ n, ts, originId }`).
- [ ] Build the local sync worker to execute targeted table delta pulls based on `prisma/sync-tables.json`.
- [ ] Implement the local `_sync_outbox` queue for offline write buffering and reliable cloud push.
- [ ] Add conflict resolution and watermark tracking storage.

### Phase 4: Dexie UI Layer & POS Hardware Integration
- [ ] Link Dexie live query hooks with local PostgreSQL changes for 0-latency UI updates.
- [ ] Add Electron native ESC/POS thermal printing service in the main process with IPC triggers.
- [ ] Add hardware test settings page in `/office/settings/hardware` (printer selection, drawer test).

### Phase 5: Verification & Packaging
- [ ] Offline simulation testing (disconnect internet, create bills, reconnect, verify cloud consistency).
- [ ] Multi-terminal latency testing (verify sub-100ms sync between two running app instances).
- [ ] Build Windows desktop installer (`.exe`) and test clean install on a fresh system.
