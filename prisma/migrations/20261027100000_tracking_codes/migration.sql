-- Settings → Tracking Codes: storefront analytics / ad pixel ids and custom HTML,
-- kept on the OrgDefaults singleton beside the other shop settings.
--
-- RELEASE GATE: OrgDefaults syncs to the counters, so every till must run the
-- build that carries this column BEFORE the d_office push applies it (AGENTS.md §3).

-- AlterTable
ALTER TABLE "OrgDefaults" ADD COLUMN "trackingCodesJson" JSONB NOT NULL DEFAULT '{}';
