-- AI Setup → Verified: Photo AI switch (owner, 2026-10-22: "if off just free
-- part, if on do full", default off to save AI cost).
--
-- RELEASE GATE: OrgDefaults syncs to the counters, so every till must run the
-- build that carries this column BEFORE the d_office push applies it (AGENTS.md §3).

-- AlterTable
ALTER TABLE "OrgDefaults" ADD COLUMN "aiPhotoCheck" BOOLEAN NOT NULL DEFAULT false;
