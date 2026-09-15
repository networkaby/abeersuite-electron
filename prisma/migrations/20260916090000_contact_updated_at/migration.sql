-- `Phone` and `Email` gain `updatedAt`, so a corrected phone number can reach a
-- counter replica — and, through it, the party list every search box reads.
--
-- This is the same fault `20260913120000_call_updated_at` fixed for `Call`, on the
-- table where it costs the most. The sync engine delta-pulls each table on a cursor
-- column; `Phone` and `Email` had only `createdAt`, so scripts/gen-sync-registry.ts
-- filed them as `append`. New phones arrived at a till, edited and deleted ones never
-- did — and the hourly reconcile could not catch it either, because an append table is
-- compared on KEYS ALONE (sync-engine/lib/reconcile.js) and editing a number leaves the
-- key untouched. A number corrected in the office therefore stayed wrong on the till
-- indefinitely, on the single field a cashier types most.
--
-- With `updatedAt` the generator files both tables as `watermark` and any write moves
-- the cursor. See prisma/sync-tables.json, tables 59 and 29 — the numbers are
-- unchanged, so no replica's stored state is orphaned. On the first cycle after the
-- upgrade each till logs `strategy changed (append -> watermark) - cursor reset`
-- (sync-engine/lib/state.js) and re-drains both tables once with the monotonic guard
-- off, which is also what brings down the corrections they are missing today.
--
-- ── Idempotent on purpose ────────────────────────────────────────────────────
-- Three ways a database can already have these columns, exactly as for `Call`:
--   * prisma/migrations/0_init/migration.sql is regenerated from the schema, so a
--     brand new database — which RUNS 0_init for real — arrives here with them.
--   * live may carry them from a hand-run `prisma db push`.
--   * a replica gets them from resources/local-schema.sql at app upgrade.
-- 0_init must NOT be edited to remove the declaration: its checksum is recorded in
-- `_prisma_migrations` on every baselined database, and changing the file makes
-- `prisma migrate deploy` refuse to run at all.
--
-- ── The backfill value is load-bearing: CURRENT_TIMESTAMP, never `createdAt` ──
-- Each replica still holds the old `append` high-water mark — the largest `createdAt`
-- it ever pulled — and reads it as an `updatedAt` cursor on the first pull after the
-- upgrade. CURRENT_TIMESTAMP is later than every existing `createdAt`, so every row
-- sorts past that stale mark and the table re-drains once. Backfilling from `createdAt`
-- would leave the stale mark ahead of most rows and they would never be pulled again —
-- the same silent hole this migration exists to close. CURRENT_TIMESTAMP is STABLE, not
-- volatile, so Postgres takes the no-rewrite path and stamps one identical value on
-- every existing row; the pull's cursor is (timestamp, id), so paging through that tie
-- loses nothing.

ALTER TABLE "Phone"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Email"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Converge the shape if a column arrived by a hand-run that left it nullable. Not
-- cosmetic: sync-engine/lib/schemaGuard.js compares data type AND nullability between
-- the source and each replica, and a mismatch halts that counter's whole worker with
-- exit 4 — every table, not just these two.
UPDATE "Phone" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "Phone" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Phone" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "Email" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "Email" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Email" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Backs the watermark pull: "anything since <ts>?" must not scan the table to say "no".
CREATE INDEX IF NOT EXISTS "Phone_updatedAt_idx" ON "Phone"("updatedAt");
CREATE INDEX IF NOT EXISTS "Email_updatedAt_idx" ON "Email"("updatedAt");
