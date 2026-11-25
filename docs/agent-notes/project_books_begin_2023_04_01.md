---
name: project-books-begin-2023-04-01
description: "CONTRADICTED 2026-09-16 — the live DB's earliest voucher is 2026-04-01, not 2023-04-01. Measure before trusting either date."
metadata: 
  type: project
  modified: 2026-09-15T20:50:30.011Z
---

**Do not act on a books-beginning date without measuring it first.** Two facts are
on record and they disagree:

- **Owner said (2026-09-11):** the business started on this software at the
  **1 Apr 2023** FY boundary, and no voucher predates it. Both `BooksConfig`
  anchors — `financialYearFrom` and `booksBeginningFrom` — were to be 2023-04-01.
- **Measured on live (2026-09-16):** the earliest `UniversalVoucher` is
  **2026-04-01** (a SALE numbered "1"), and **all 3,623 vouchers sit in calendar
  2026**. Nothing from 2023, 2024 or 2025 exists in this database.

The voucher numbered 1 on 1 Apr 2026 reads like a fresh start rather than a
carried-over book, so the live DB's real floor is **2026-04-01**. Whether the
2023 figure refers to the previous software / Vyapar source books, or the live DB
was reset at some point, is **not yet resolved — ask the owner.**

**Why:** the gap nearly caused a real mistake. Backfilling opening balances into
bill-wise vouchers ([project_opening_balances_now_billwise](project_opening_balances_now_billwise.md)) needed a bill date,
and dating them 2023-04-01 "because the books begin then" would have put every
opening outside the only period that has data. `defaultOpeningDateIso()` returns
1 Apr of the *current* FY (2026-04-01), which turned out to be exactly right here
— but only because the measurement was done first.

**How to apply:** before setting any date floor, FY picker default, report range
or `assertVoucherDate` anchor, query the earliest voucher on the DB that is
actually active. Do not quote 2023-04-01 as settled fact. See
[project_db_probing_via_dev_server](project_db_probing_via_dev_server.md) for how to run that read-only probe.
