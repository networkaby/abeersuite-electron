---
name: project_service_income_reclass
description: "Vyapar service income now sits on each original voucher as an Additional Income row, not in Sales A/c — done 17 Sep 2026."
metadata: 
  type: project
  modified: 2026-09-17T06:52:11.544Z
---

The Vyapar import posted every sale line to `Sales A/c`, services included,
because `buildSpec` credits one ledger for all lines and products carry no
income ledger — only the `PosService` catalogue does.

First attempt was one journal (JV-10786-26). The owner rejected that shape: the
service PRODUCT must become an **Additional Income row on its own voucher**,
voucher total and party total unchanged, GST mismatch accepted. So JV-10786-26
was cancelled and, on 17 Sep 2026, **98 of 99 vouchers** were rewritten — the
service line deleted, its FULL gross added as a charge row on the matching
ledger. Ledgers landed exactly: Desktop 11,815 · Printer 16,350 · Laptop
29,104.91 (incl. 694.91 already there) · CCTV 1,400. Trial balance level.

Things learned, all verified:

- Recomputing a voucher's remaining lines drifts a paisa or two from the stored
  amounts (imported rates were back-derived). Compute the needed `roundOff`
  BEFORE patching — `totalBefore − (subtotal + shipping − billDisc + charges)` —
  or the edit is refused for not matching its payment rows.
- **SV-930800-26 and SV-930799-26 (16 Sep) carry `branchId: null` on the spine**
  and cannot be edited at all — even a no-op edit 500s, because the edit route's
  re-post passes `branchId ?? ""`. Its ₹2,050 is still unconverted.
- Service items are also on **27 PURCHASE lines, ₹20,370** (Laptop 11, Printer
  16) — sub-contracted repairs booked as goods. Those are the stock INs that now
  leave Printer reading +6. Still open: which expense ledger they move to.
- A charge row through the voucher API cannot carry GST; only the POS sale route
  builds tax-bearing charges.

See [project_db_probing_via_dev_server](project_db_probing_via_dev_server.md) and [project_dev_server_writes_to_live](project_dev_server_writes_to_live.md).
