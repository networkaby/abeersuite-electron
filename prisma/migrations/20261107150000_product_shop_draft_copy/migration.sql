-- A draft is a separate working copy, not a stage (owner, 2026-11-07): edits to
-- a product (by staff, AI or Claude) wait in shopDraftJson while the shop keeps
-- showing the last finished version; "Save as ready" puts them on the product.
-- The Claude-only copyDraft columns become the general draft.
ALTER TABLE "InvProduct" RENAME COLUMN "copyDraftJson" TO "shopDraftJson";
ALTER TABLE "InvProduct" RENAME COLUMN "copyDraftAt" TO "shopDraftAt";

-- A Claude draft saved before this was the copy itself; it is now { aiCopy }.
UPDATE "InvProduct"
SET "shopDraftJson" = jsonb_build_object('aiCopy', "shopDraftJson"), "updatedAt" = now()
WHERE "shopDraftJson" IS NOT NULL AND NOT ("shopDraftJson" ? 'aiCopy') AND NOT ("shopDraftJson" ? 'patch');

-- DRAFT is no longer a stage: those products were not worked to completion.
-- An open draft copy (above) keeps their work.
UPDATE "InvProduct" SET "shopStatus" = 'UNPUBLISHED', "updatedAt" = now() WHERE "shopStatus" = 'DRAFT';
