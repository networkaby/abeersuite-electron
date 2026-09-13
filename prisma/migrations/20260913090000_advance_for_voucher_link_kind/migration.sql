-- ADVANCE_FOR: a counter advance Receipt pointing at the order it was collected
-- against. Its own migration because Postgres will not let a value added to an
-- enum be USED in the same transaction that adds it, and the next migration
-- writes rows with this value.
ALTER TYPE "VoucherLinkKind" ADD VALUE 'ADVANCE_FOR';
