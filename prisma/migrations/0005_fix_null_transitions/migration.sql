-- Remove duplicate entry-point transitions (where fromSubStatusId IS NULL)
-- PostgreSQL treats NULLs as distinct in unique indexes, so duplicates can exist.
-- Keep only the lowest-id row for each (null, toSubStatusId) pair.
DELETE FROM "SubStatusTransition"
WHERE id NOT IN (
    SELECT MIN(id)
    FROM "SubStatusTransition"
    WHERE "fromSubStatusId" IS NULL
    GROUP BY "toSubStatusId"
)
AND "fromSubStatusId" IS NULL;

-- Drop the existing index that doesn't enforce null uniqueness
DROP INDEX IF EXISTS "SubStatusTransition_fromSubStatusId_toSubStatusId_key";

-- Recreate with NULLS NOT DISTINCT (PostgreSQL 15+) so (null, X) is treated as unique
CREATE UNIQUE INDEX "SubStatusTransition_fromSubStatusId_toSubStatusId_key"
    ON "SubStatusTransition"("fromSubStatusId", "toSubStatusId") NULLS NOT DISTINCT;
