-- POS bill key: a one-time id per bill, so a retried Save can never write the
-- same sale twice.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- If the office commits a sale and the reply is then lost (internet blip, Vercel
-- timeout, counter line drop), the cashier sees an error and presses Save again.
-- Until now that wrote a second bill: stock out twice, GL twice, two POS numbers.
-- The screen now sends the same key on every Save of one bill, and
-- POST /api/pos/sale answers "already saved" when a voucher already carries it.
-- The unique index is the real guard: two Saves landing at the same moment both
-- miss the look-up, and the second insert fails on this index instead.
--
-- Nullable: every older voucher, and every voucher that is not a POS sale, keeps
-- NULL, and Postgres lets NULLs repeat under a unique index. No data move.
--
-- RELEASE GATE: a new column syncs to the counters, so every till must run the
-- build that carries it BEFORE the d_office push applies this (AGENTS.md §3).

-- AlterTable
ALTER TABLE "UniversalVoucher" ADD COLUMN     "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UniversalVoucher_requestKey_key" ON "UniversalVoucher"("requestKey");
