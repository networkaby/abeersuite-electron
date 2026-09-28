-- Storefront ad inventory (Ecommerce -> Ads). One JSON column on the settings
-- singleton, same idea as storefrontHomeJson. Idempotent: 0_init is
-- frozen and never declared it, but a replica may already carry it from
-- local-schema.sql.
ALTER TABLE "OrgDefaults" ADD COLUMN IF NOT EXISTS "storefrontAdsJson" JSONB;
