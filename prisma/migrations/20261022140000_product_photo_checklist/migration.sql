-- Photo checklist under Product image (owner, 2026-10-22): the Verified AI says
-- which kinds of photo the gallery has and misses; staff tick them off.
--
-- RELEASE GATE: InvProduct syncs to the counters, so every till must run the
-- build that carries this column BEFORE the d_office push applies it (AGENTS.md §3).

-- AlterTable
ALTER TABLE "InvProduct" ADD COLUMN "photoChecklistJson" JSONB;
