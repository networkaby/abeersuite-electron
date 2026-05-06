-- Three-tier delete (void / soft delete / hard delete) on JournalEntry.
-- Adds actor + reason + soft-delete columns, plus an audit table that
-- records hard-delete snapshots so the deletion itself is traceable.

-- 1. New columns on JournalEntry
ALTER TABLE "JournalEntry"
    ADD COLUMN "voidedById"   INTEGER,
    ADD COLUMN "deletedAt"    TIMESTAMP(3),
    ADD COLUMN "deletedById"  INTEGER,
    ADD COLUMN "deleteReason" TEXT;

-- 2. FKs back to User
ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_voidedById_fkey"
        FOREIGN KEY ("voidedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "JournalEntry_deletedById_fkey"
        FOREIGN KEY ("deletedById") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Index for soft-delete filter (every aggregation query now adds `deletedAt: null`)
CREATE INDEX "JournalEntry_deletedAt_idx" ON "JournalEntry"("deletedAt");

-- 4. Hard-delete audit table
CREATE TABLE "JournalEntryAudit" (
    "id"          SERIAL       PRIMARY KEY,
    "originalId"  INTEGER      NOT NULL,
    "originalRef" TEXT         NOT NULL,
    "action"      TEXT         NOT NULL,
    "reason"      TEXT,
    "snapshot"    JSONB        NOT NULL,
    "actorId"     INTEGER      NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntryAudit_actorId_fkey"
        FOREIGN KEY ("actorId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "JournalEntryAudit_originalId_idx" ON "JournalEntryAudit"("originalId");
CREATE INDEX "JournalEntryAudit_actorId_idx"    ON "JournalEntryAudit"("actorId");
CREATE INDEX "JournalEntryAudit_createdAt_idx"  ON "JournalEntryAudit"("createdAt");
