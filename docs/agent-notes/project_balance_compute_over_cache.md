---
name: project_balance_compute_over_cache
description: Bounded account sets compute from the ledger; only whole-chart surfaces still read Account.balance.
metadata: 
  type: project
  modified: 2026-09-20T19:10:03.743Z
---

> **May be outdated:** since 2026-10-12 nothing on screen reads `Account.balance` (see the update at the end).

Owner's rule, 2026-09-21: move from cache to compute wherever the local replica
makes the compute cheap. Landed as 914ed156 on dev.

Bounded set of accounts → `closingForAccounts` (sums VoucherGlLine + master
opening). Whole chart at once → keep `Account.balance` (`effectiveAccountBalance`,
`closingFromCache`), because computing is a full-ledger scan per request.

Moved to compute: `checkCreditLimit`, POS `account-snapshot`, `/api/person`,
`/api/companies`, `deleteParty`, `pos/shifts/current`. `tillBalancesPaise` was
already there and set the precedent.

Measured on abeersuite_dev (3,835 accounts, 13,974 GL lines): one account 2ms,
50-party page 3ms, all party accounts 46ms, whole ledger 86ms.

`asOf = null` on `aggregateClosingAsOf` means no date ceiling — matches what the
cache held, and is what a credit gate needs. Zero future-dated openings exist,
so it is the only behavioural difference and it is currently moot.

Stock and gift-card caches deliberately untouched — read per keystroke.

Browser-verified 2026-09-21 in Chrome against the dev server: party lists and
Companies render correct Dr/Cr, POS account-snapshot agrees with the lists, the
maintenance dry run reports driftCount 0 across all 3,835 accounts (so cache ==
ledger and the swap changed no number), no console errors. Warm timings: party
page 259ms, whole unpaginated list 2.8s (3,666 rows — serialisation, not the
46ms aggregate), snapshot ~0.55s. The two write paths — the sale's credit gate
and party delete — are still NOT exercised. (The reason first recorded here, "the
dev server writes to live", was wrong: it writes to the local copy — see
[project_dev_server_writes_to_live](project_dev_server_writes_to_live.md). They can be tested safely.)

**Why:** drift in `Account.balance` used to be able to extend credit or erase a
party that still owed money. It is now a display matter only.

**How to apply:** new surface showing a balance → if you know the account ids,
call `closingForAccounts`, never `Account.balance`. Related:
[project_db_probing_via_dev_server](project_db_probing_via_dev_server.md), [project_abeersuite_dev_local_copy](project_abeersuite_dev_local_copy.md).


Update 2026-10-12: the whole-chart exception is gone too — the ledger list and top bar now sum the GL. See [project_account_balance_column_to_drop](project_account_balance_column_to_drop.md).
