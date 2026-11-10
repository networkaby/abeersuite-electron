-- Product variants (owner, 2026-11-10): products that are one item in different
-- options (XYZ Black / XYZ Blue) share a hidden family number. Each product stays
-- independent (own photos, title, price, stock); the shop shows option buttons
-- labelled by variantLabel. Optional — null = not in a family.
ALTER TABLE "InvProduct" ADD COLUMN "variantFamilyId" INTEGER;
ALTER TABLE "InvProduct" ADD COLUMN "variantLabel" TEXT;

CREATE INDEX "InvProduct_variantFamilyId_idx" ON "InvProduct"("variantFamilyId");
