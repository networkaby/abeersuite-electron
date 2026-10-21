-- AI Setup: calls-per-month limit per key (2026-10-21). Counted in memory per
-- server like the daily limit (owner's pick); only the limit itself is stored.
--
-- RELEASE GATE: ai_keys syncs to the counters, so every till must run the build
-- that carries this column BEFORE the d_office push applies it (AGENTS.md §3).

-- AlterTable
ALTER TABLE "ai_keys" ADD COLUMN "monthlyLimit" INTEGER;
