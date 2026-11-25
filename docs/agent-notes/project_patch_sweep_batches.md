---
name: project_patch_sweep_batches
description: "\"Find patches and refactor to real code\" — Batch 1 landed 2026-09-30, Batch 2 (shared screen hooks) 2026-10-01; Batches 3 (DB rules via migration) and 4 (counter/sync engine) listed, not started"
metadata:
  type: project
  modified: 2026-09-30T00:05:57.416Z
---

On 2026-09-29 the owner asked "find patches and refactor to real code". Three read-only sweeps found about 60 workarounds, and the owner picked **Batch 1 only** (live bugs, no DB change). All nine items are committed on `main` (343d7092 … 868905f5), plus a lint cleanup. Each has a 2026-09-30 PROJECT_BRAIN entry.

**Still open — offer these as the next rounds and don't redo the sweep:**
- **B2 DONE 2026-10-01** (09ba9a7b, 1e1a3d8b, e7b9fe94, 2b70a9c8, 0c18bdb7, 3f2dc174, f69d3a86, 3f2308e8, ed540e3a) — useApiResource topics/keepPrevious/reload-payload, usePartyProfile, usePagedQuery, useFormChanges (first-press baseline, not snapshotsEqual), invalidateProductCatalog / invalidateGlAccounts + onMastersChanged wiring, useComboboxNav without blur timer, NumericInput sweep, coupon signature, composeLineDescription. Verified by tsc/eslint + Playwright harnesses only — not yet on live screens. Left over: Ctrl+Enter on an overlay-only ledger opens EditLedgerDialog with {id,name,groupId} only (save would blank particulars); `NumericInput` valueAsNumber/uncontrolled mode was not needed.
- **B3a DONE 2026-10-01, NOT DEPLOYED** (e0b1bd54, 6c0e8e8f, a359f65c, 6cd20b58; migration 20261001120000_db_rules_b3a): credit-limit wording, journal carrier gone, InvStockLedger.reversalOfId, POS_ESTIMATE/POS_ORDER series + unique (type,voucherNo) posted index (OPENING excluded). Owner: phone/email may have no owner or both — the seed's XOR CHECK contradicts it (open). Needs electron:release before the d_office deploy.
- **B3a shipped in v1.10.1. B3b DONE 2026-10-02, NOT RELEASED** (bd3fd78c…9db207dc, migration 20261002090000_db_cleanup_b3b): push column filter, deletedAt cols dropped, VoucherSeries.nextSeq dropped, VoucherInventoryLine.note + one-time split, count path removed. GATE: every till on the new build before the d_office push. VoucherDetail.universalVoucherId NOT NULL deliberately skipped (replica FK stays SET NULL → till queue would block).
- **B3 original list (for reference):**
  - Phone/Email XOR CHECK moved from the seed into a migration. Today it exists only where the seed ran.
  - `creditLimit` NOT NULL.
  - Drop the never-written `deletedAt` / `deletedById` / `deleteReason` columns and their ~200 filters.
  - Finish `VoucherSeriesCounter` and drop `VoucherSeries.nextSeq`.
  - One voucher-number allocator. `POS_ESTIMATE` / `POS_ORDER` still use the count-based prefix.
  - `universalVoucherId` NOT NULL, plus removing the journal "carrier" orphan writer.
  - `InvStockLedger.reversalOfId`.
  - Larger, owner call per item: ledger `systemRole` instead of name lists, the duplicate `partyType` / `partyId`, bill-link foreign keys, GL role backfill, a typed recycle bin, `legacyStatus`, `User.role`.
- **B4, counter/sync, release-only:**
  - Clean child shutdown: IPC handshake and `pg_ctl stop -D`.
  - IPC messages instead of matching stdout text.
  - Restart a crashed bridge / sync worker.
  - One `globalThis` state in the Next server. The push-health badge can never show a failure today.
  - Verify Supabase TLS with a shipped CA. `rejectUnauthorized: false` sits in three places.
  - Sync bookkeeping tables in the counter-local DDL.
  - Largest: a server-assigned change feed instead of the `updatedAt` cursor.

**Why:** the owner scoped round one to Batch 1. See [feedback_permanent_fix_not_patch](feedback_permanent_fix_not_patch.md): lead with the proper fix and leave working screens' layout alone.

**How to apply:** next time, open with these batches, ask which one, and verify each finding against current code first — `main` moves quickly. Owner calls still pending:
- `api/calls` POST accepts everything while `CALLS_API_KEY` is unset.
- Making `auth.d.ts` real needs a dependency change ([project_auth_d_ts_never_applies](project_auth_d_ts_never_applies.md)).
