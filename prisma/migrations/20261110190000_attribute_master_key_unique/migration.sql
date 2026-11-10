-- Attribute key is unique on its own (owner, 2026-11-10). The old (key, groupId)
-- unique let duplicate global keys in, because Postgres treats NULLs as distinct.
-- Labels may repeat. Products store the key string, so dropping an extra
-- duplicate row loses nothing: keep the oldest row per key.
DELETE FROM "InvAttributeMaster" a
USING "InvAttributeMaster" b
WHERE a."key" = b."key" AND a."id" > b."id";

DROP INDEX IF EXISTS "InvAttributeMaster_key_groupId_key";
CREATE UNIQUE INDEX "InvAttributeMaster_key_key" ON "InvAttributeMaster"("key");
