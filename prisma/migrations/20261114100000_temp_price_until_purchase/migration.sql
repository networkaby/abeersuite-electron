-- Fixed Price "until next purchase" (2026-11-14): a temporary selling price that
-- the next posted purchase ends. Nullable, nothing to carry over.
ALTER TABLE "InvProduct" ADD COLUMN IF NOT EXISTS "tempPriceAfterLedgerId" INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN IF NOT EXISTS "tempPriceSetAt" TIMESTAMP(3);
