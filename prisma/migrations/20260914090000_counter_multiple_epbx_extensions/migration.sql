-- A counter may now sit at several EPBX extensions, stored as one comma-separated
-- list ("201,202"). A list cannot be uniquely indexed per entry, so the unique
-- index goes; overlap across counters is rejected by PATCH /api/pos/counters/[id].
DROP INDEX IF EXISTS "pos_counters_epbxExtension_key";
