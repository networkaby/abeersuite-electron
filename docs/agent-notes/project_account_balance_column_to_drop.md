---
name: project-account-balance-column-to-drop
description: "Account.balance cache is display-dead since 5e8c9966 (2026-10-12); owner plans to drop the column, so never patch its drift"
metadata:
  type: project
  modified: 2026-10-12T04:30:55.675Z
---

Since commit 5e8c9966 (2026-10-12) no screen reads `Account.balance`: the ledger list, Bank/Cash Book, ledger PATCH response and finance top bar (cash-position, usable-fund) all sum the GL via `closingForAccounts` / `aggregateClosingAsOf`. `effectiveAccountBalance`, `closingFromCache` and `effectiveBalance.ts` were deleted.

Known drift cause, deliberately NOT fixed: changing a ledger's group (`ledgers/[id]` PATCH) flips its Dr/Cr nature without rebuilding the cache, so a later cancel/delete reverses with the wrong sign (3 Routing A/c left at 2,000 Cr).

**Why:** owner 2026-10-12 — "we shifted to computed balance instead of cache, in future we need to delete the column". Each counter holds a full replica, so summing is cheap.

**How to apply:** never add code that reads or repairs `Account.balance`; show balances via the GL-sum helpers. Removal job (future, owner's timing) must strip the writers: `applyLineBalances` / `recomputeAccountBalances` callers in journal-entries + vouchers + inventory vouchers routes (post/cancel/restore/hard-delete), `transactionEngine`, `cancel/park/restore/reapplyTradingVoucher`, `auditRestore`, `openingBills`, `sync/rebuildTotals`, `convertParty` merge sum, the recompute-balances route/seed/script, parity-harness — plus a migration (counters before the d_office deploy, see [project_schema_ships_via_migrations](project_schema_ships_via_migrations.md)). `GiftCard.balance` is a different column; keep it.

**Deferred 2026-10-12:** owner asked to leave the column and its writers in place as a safety net ("we will clean later"). Do not start the removal unprompted. Findings for when it starts: push already strips columns the office lacks (`onlyColumns`, since v1.11.0 / B3b), so a DROP is safe for tills ≥1.11; the replica outbox trigger is generated with `'--cache','balance'` from `sync-tables.json` overrides (remove the override, regen `sync:tables` + `db:local-schema`); old replicas keep the column (NOT NULL default 0, harmless); other touch points are `hard-clean.ts`, `personalSnapshot.ts` omit list, `seed:recompute-balances`, `recompute:caches`, `check-guard-lint.ts` balance rule. Removing the field from `accounts.prisma` then running tsc lists every remaining reader. Each voucher post also bumps `Account.updatedAt` through the increment, so removing it cuts Account sync traffic; `isUnchangedSince` watches UniversalVoucher, not Account. Related: [project_balance_compute_over_cache](project_balance_compute_over_cache.md).
