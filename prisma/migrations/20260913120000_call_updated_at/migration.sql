-- `Call` gains `updatedAt`, so a staff edit to a call can reach a counter replica.
--
-- The sync engine delta-pulls each table on a cursor column. `Call` had only
-- `createdAt`, so the generator filed it as `append`: new calls arrived, edits never
-- did. The counter's call follow-up popup therefore kept re-showing calls staff had
-- already logged — the note and the ticket link sat in Supabase and never came down,
-- and the hourly reconcile could not catch it either (an append table is compared on
-- keys alone, and the keys matched). With `updatedAt` the generator files the table as
-- `watermark` and a PATCH moves the cursor. See prisma/sync-tables.json, table 11 —
-- the number is unchanged, so no replica's stored state is orphaned.
--
-- ── Idempotent on purpose, unlike its two neighbours ─────────────────────────
-- Three ways a database can already have this column:
--   * `prisma/migrations/0_init/migration.sql` was regenerated AFTER the column was
--     added to prisma/schema/calls.prisma, so the baseline already declares both the
--     column and the index. A brand new database RUNS 0_init for real — it is only
--     marked-applied on databases that predate 2026-09-13 — and would then reach this
--     migration with both in place.
--   * live already carries it from a hand-run `prisma db push` (2026-09-13).
--   * a replica gets it from resources/local-schema.sql at app upgrade.
-- 0_init itself must NOT be edited to remove the declaration: its checksum is recorded
-- in `_prisma_migrations` on every baselined database, and changing the file makes
-- `prisma migrate deploy` refuse to run at all.
--
-- ── The backfill value is load-bearing: CURRENT_TIMESTAMP, never `createdAt` ──
-- Each counter replica still holds the old `append` high-water mark — the largest
-- `createdAt` it ever pulled — and reads it as an `updatedAt` cursor on the first pull
-- after the upgrade. CURRENT_TIMESTAMP is later than every existing `createdAt`, so
-- every row sorts past that stale mark and the table re-drains once, which is what is
-- wanted: it also brings down the notes the tills are missing today. Backfilling from
-- `createdAt` would leave the stale mark ahead of most rows and they would never be
-- pulled again — the same silent hole this migration exists to close.
-- CURRENT_TIMESTAMP is STABLE, not volatile, so Postgres takes the no-rewrite path and
-- stamps one identical value on every existing row; the pull's cursor is
-- (timestamp, id), so paging through that tie loses nothing.

ALTER TABLE "Call"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Converge the shape if the column arrived by a hand-run that left it nullable. Not
-- cosmetic: sync-engine/lib/schemaGuard.js compares data type AND nullability between
-- the source and each replica, and a mismatch halts that counter's whole worker with
-- exit 4 — every table, not just this one.
UPDATE "Call" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "Call" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Call" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Backs the watermark pull: "anything since <ts>?" must not scan the table to say "no".
CREATE INDEX IF NOT EXISTS "Call_updatedAt_idx" ON "Call"("updatedAt");
