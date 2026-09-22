-- HR → Pay Rules: one JSON blob of the shop's time-to-money rules on the
-- OrgDefaults singleton. Nullable, so every existing row keeps the code
-- defaults until somebody saves the screen once.
ALTER TABLE "OrgDefaults" ADD COLUMN "hrPayRulesJson" JSONB;
