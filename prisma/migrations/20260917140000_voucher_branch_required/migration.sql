-- Every voucher gets a branch. Backfill, then the column goes NOT NULL.
--
-- ── The fault ────────────────────────────────────────────────────────────────
-- The column was made nullable in Phase 5 5D-12 on the reading that a money
-- voucher can be "org-level" — belonging to the business rather than to any one
-- branch. Inventory and POS vouchers always set it; financial ones were left
-- best-effort.
--
-- Org-level turned out not to be a state anybody chose. It was whatever the
-- working-branch picker happened to be on: POST /api/accountancy/vouchers
-- resolved the active branch inside a try/catch and, on the "All branches"
-- sentinel, saved NULL rather than refusing. Worse, the two vouchers the POS
-- raises when a shift closes — the sweep Contra and the variance Journal —
-- passed no branch at all, though the shift they come from names one. So a
-- till's own closing paperwork filed itself under no branch.
--
-- A blank branch is not neutral. Every branch-wise report filters on this
-- column, so those vouchers are absent from all of them, and absent without
-- saying so: the totals simply come out short and nothing announces it.
--
-- ── What changes ─────────────────────────────────────────────────────────────
-- The write paths are closed in the same commit: `requireWritableBranchId`
-- refuses the combined sentinel with `select_working_branch` (the screen shows
-- "Switch from 'My branches' to a specific branch to post this transaction"),
-- and `branchId` is a REQUIRED argument on engineCreateVoucher / enginePost /
-- engineCreateSpine / postContra, so the compiler — not a reviewer — is what
-- stops a new caller skipping it. Background jobs that have no user and so no
-- picker (gift-card breakage expiry) take `systemBranchId`, which is Head
-- Office. Owner's decision, 2026-09-17.
--
-- ── The backfill, in order ───────────────────────────────────────────────────
-- It runs here rather than only in a script for the same reason the opening-stock
-- backfill did: `prisma migrate deploy` is what carries schema to live, and the
-- same file is what a counter replica applies, so data and column land together
-- on every database in one step. `pnpm backfill:voucher-branch` exists to PREVIEW
-- this against live before deploying — read it first, especially the Head Office
-- bucket.
--
--   1. The source counter's branch. Exact: `sourceCounterId` records the till
--      that raised the voucher, and a till belongs to one branch.
--   2. The shift's branch — a voucher raised on a shift but at no counter.
--   3. Head Office ('BR-HQ'). The last resort for office vouchers that record
--      neither, where nothing else is knowable. This is the only guessed step.
--
-- Each step is guarded by `branchId IS NULL`, so re-running changes nothing and
-- a row already filled by the preview script is left alone.
--
-- ── SET NOT NULL, and the counter rule that goes with it ────────────────────
-- ⚠ THE COUNTER RELEASE MUST GO OUT BEFORE THE VERCEL DEPLOY THAT CARRIES THIS.
--
-- sync-engine/lib/schemaGuard.js compares each column's nullability. Until this
-- release, ANY difference was filed under `changed`, and `changed` halts that
-- till's ENTIRE sync worker (exit 4) — not just this table. That mattered here
-- because a replica receives schema only through resources/local-schema.sql,
-- which reaches an EXISTING table via `ADD COLUMN IF NOT EXISTS` — a no-op on a
-- column already present (scripts/gen-local-schema.ts states the limit itself).
-- So a NOT NULL server could never be mirrored onto an old replica.
--
-- The guard is fixed in this same release: nullability is now DIRECTIONAL. A
-- replica that is NULLABLE while the source is NOT NULL merely permits something
-- the source never sends, so every row still lands — that is reported, not
-- fatal. The dangerous direction (source nullable, replica NOT NULL, which would
-- drop rows) still halts, as do type changes and missing columns.
--
-- Hence the ordering: a till running the OLD guard against this NOT NULL server
-- would still halt. Ship the counter build first, then deploy this.
--
-- The ALTER is guarded rather than bare: if any row is somehow still blank when
-- this runs, the column is left nullable with a warning instead of failing the
-- whole deploy on an ALTER that cannot succeed. The backfill above covers every
-- row it can see, so the only way to reach that branch is a row written between
-- the UPDATEs and the ALTER.
--
-- The foreign key also tightens from ON DELETE SET NULL to ON DELETE RESTRICT,
-- which is what a required relation means: a branch that still has vouchers
-- against it can no longer be deleted, and deleting one can no longer silently
-- blank the branch on its whole history.

-- 1. From the counter that raised it.
UPDATE "UniversalVoucher" v
   SET "branchId" = c."branchId"
  FROM "PosCounter" c
 WHERE v."branchId" IS NULL
   AND v."sourceCounterId" = c."id"
   AND c."branchId" IS NOT NULL;

-- 2. From the shift it was raised on.
UPDATE "UniversalVoucher" v
   SET "branchId" = s."branchId"
  FROM "PosShift" s
 WHERE v."branchId" IS NULL
   AND v."sourceShiftId" = s."id"
   AND s."branchId" IS NOT NULL;

-- 3. Head Office for the rest. EXISTS so a database that has no 'BR-HQ' (a fresh
--    demo, or a setup that renamed its branches) is not handed an FK violation.
UPDATE "UniversalVoucher"
   SET "branchId" = 'BR-HQ'
 WHERE "branchId" IS NULL
   AND EXISTS (SELECT 1 FROM "Branch" WHERE "id" = 'BR-HQ');

-- 4. Lock it — only when every row actually has one.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "UniversalVoucher" WHERE "branchId" IS NULL) THEN
        RAISE WARNING
            'UniversalVoucher.branchId left NULLABLE: % row(s) still have no branch. Run pnpm backfill:voucher-branch --apply, then re-deploy.',
            (SELECT count(*) FROM "UniversalVoucher" WHERE "branchId" IS NULL);
    ELSE
        ALTER TABLE "UniversalVoucher" ALTER COLUMN "branchId" SET NOT NULL;

        -- A required relation restricts instead of nulling out. Dropped and
        -- re-added because Postgres cannot alter a foreign key's action in place.
        ALTER TABLE "UniversalVoucher" DROP CONSTRAINT IF EXISTS "UniversalVoucher_branchId_fkey";
        ALTER TABLE "UniversalVoucher"
            ADD CONSTRAINT "UniversalVoucher_branchId_fkey"
            FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
