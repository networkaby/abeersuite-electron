-- Every voucher gets a branch. Backfill only — the column stays NULLABLE.
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
-- ── Why this does NOT add NOT NULL ───────────────────────────────────────────
-- Locking the column is the natural next step and it is deliberately NOT taken
-- here, because a counter replica cannot be given a nullability change:
--
--   * sync-engine/lib/schemaGuard.js fingerprints every column as
--     `data_type:is_nullable`, files any difference under `changed`, and
--     `changed` halts that till's ENTIRE worker (exit 4) — not just this table.
--   * A replica receives schema only through resources/local-schema.sql, which
--     reaches an EXISTING table via `ADD COLUMN IF NOT EXISTS` — a no-op on a
--     column that is already there. scripts/gen-local-schema.ts states the limit
--     itself: "a new NOT NULL column ... is not expressible as an additive
--     ALTER", and there is no second mechanism (electron/localDbProvisioner.ts).
--
-- So a NOT NULL here would put live permanently out of step with every replica
-- and stop every counter, with no shippable way to bring them back into line.
-- The rule is enforced in the application instead — requireWritableBranchId on
-- the write paths, and `branchId` as a required argument on every engine entry
-- point, so the compiler refuses a caller that omits it. Locking the column is
-- worth doing once the replica side can carry a nullability change.

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
