-- An attribute applies to several groups (owner, 2026-11-10): "Length" on Wire,
-- USB Cable and Cat 6 Cable, which sit under different parents. A ticked group
-- covers its subgroups; an attribute with no rows is global.
CREATE TABLE "inv_attribute_master_groups" (
    "attributeId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "inv_attribute_master_groups_pkey" PRIMARY KEY ("attributeId","groupId")
);

CREATE INDEX "inv_attribute_master_groups_groupId_idx" ON "inv_attribute_master_groups"("groupId");

ALTER TABLE "inv_attribute_master_groups" ADD CONSTRAINT "inv_attribute_master_groups_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "InvAttributeMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inv_attribute_master_groups" ADD CONSTRAINT "inv_attribute_master_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InvProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the single group over before the column goes.
INSERT INTO "inv_attribute_master_groups" ("attributeId", "groupId")
SELECT "id", "groupId" FROM "InvAttributeMaster" WHERE "groupId" IS NOT NULL;

ALTER TABLE "InvAttributeMaster" DROP CONSTRAINT IF EXISTS "InvAttributeMaster_groupId_fkey";
DROP INDEX IF EXISTS "InvAttributeMaster_groupId_idx";
ALTER TABLE "InvAttributeMaster" DROP COLUMN "groupId";
