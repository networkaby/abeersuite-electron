-- A customer's address book (PersonAddress). Staff add the first address, the
-- customer adds / edits more on the portal and picks one at checkout.
-- Person.address stays as the plain text bills and POS read.
CREATE TABLE "PersonAddress" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "label" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "locality" TEXT,
    "neighbourhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonAddress_personId_idx" ON "PersonAddress"("personId");
CREATE INDEX "PersonAddress_updatedAt_idx" ON "PersonAddress"("updatedAt");
CREATE INDEX "PersonAddress_pincode_idx" ON "PersonAddress"("pincode");

ALTER TABLE "PersonAddress" ADD CONSTRAINT "PersonAddress_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sync-touch: PersonAddress -> Person. An address edit moves the customer's
-- updatedAt, so the counters pull it. Created before the copy below on purpose:
-- the copied rows then reach every counter on its next pull.
DROP TRIGGER IF EXISTS "sync_touch_parent" ON "PersonAddress";
CREATE TRIGGER "sync_touch_parent" AFTER INSERT OR UPDATE OR DELETE ON "PersonAddress"
    FOR EACH ROW EXECUTE FUNCTION sync_touch_parent('personId', 'Person', 'id', 'updatedAt');

-- Each customer's existing text address becomes their first (primary) address,
-- word for word in line1 — no guessing at city or PIN. Person.address is not
-- touched, so nothing that prints it changes.
INSERT INTO "PersonAddress" ("personId", "line1", "isPrimary")
SELECT "id", btrim("address"), true
FROM "Person"
WHERE "address" IS NOT NULL AND btrim("address") <> '';
