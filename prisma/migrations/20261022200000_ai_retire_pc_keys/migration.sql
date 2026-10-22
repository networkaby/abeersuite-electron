-- AI Setup: retire the "this PC only" (ini) key kind (owner, 2026-10-22: "the key
-- saved in .ini creating problem retire it … do permanent fix not patch").
-- Those rows held no key, only a pointer to one PC's file; the app no longer reads
-- that file, so the rows are deleted. Their chain steps go with them (ON DELETE CASCADE).
--
-- Data only, no column change: no counter release gate. A till drops the rows at
-- its next hourly reconcile (docs/migrations.md — a delete reaches a replica there).

DELETE FROM "ai_keys" WHERE "source" NOT IN ('db', 'env');
