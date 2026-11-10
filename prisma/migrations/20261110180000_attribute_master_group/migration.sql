-- Attribute masters are scoped by product group, not collection (owner, 2026-11-10).
-- Collection scoping is dropped; every existing attribute becomes global (groupId null).
ALTER TABLE "InvAttributeMaster" DROP CONSTRAINT IF EXISTS "InvAttributeMaster_categoryId_fkey";
DROP INDEX IF EXISTS "InvAttributeMaster_key_categoryId_key";
DROP INDEX IF EXISTS "InvAttributeMaster_categoryId_idx";
ALTER TABLE "InvAttributeMaster" DROP COLUMN "categoryId";

ALTER TABLE "InvAttributeMaster" ADD COLUMN "groupId" INTEGER;
CREATE INDEX "InvAttributeMaster_groupId_idx" ON "InvAttributeMaster"("groupId");
CREATE UNIQUE INDEX "InvAttributeMaster_key_groupId_key" ON "InvAttributeMaster"("key", "groupId");
ALTER TABLE "InvAttributeMaster" ADD CONSTRAINT "InvAttributeMaster_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
