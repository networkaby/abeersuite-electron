-- A post written differently per channel: each channel may carry its own text,
-- time and photos (`variants`), drawing on photos beyond the main one
-- (`extraMedia`). Defaults keep every existing post exactly as it was — one
-- copy for all channels, its single photo.
ALTER TABLE "Post" ADD COLUMN "extraMedia" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Post" ADD COLUMN "variants" JSONB NOT NULL DEFAULT '{}';
