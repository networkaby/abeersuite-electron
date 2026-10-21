-- AI Setup: which product-description option (direct | verified) every product
-- page opens on — the admin's pick (owner, 2026-10-22). Staff may switch for one write.
--
-- RELEASE GATE: OrgDefaults syncs to the counters, so every till must run the
-- build that carries this column BEFORE the d_office push applies it (AGENTS.md §3).

-- AlterTable
ALTER TABLE "OrgDefaults" ADD COLUMN "aiCopyFlow" TEXT NOT NULL DEFAULT 'verified';
