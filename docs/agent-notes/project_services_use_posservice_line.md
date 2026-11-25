---
name: project_services_use_posservice_line
description: "A service on a voucher is a PosService line, never a manual charge row or a stock product; service items keep no stock record."
metadata: 
  type: project
  modified: 2026-09-17T15:39:09.755Z
---

Booking a service on any voucher (sale or purchase) goes through the app's **PosService catalogue** — `services: [{serviceId, quantity, unitPrice}]` on the voucher API — not a hand-built `charges` row and not an `InvProduct`.

Why: the service line keeps the bill's subtotal and its GST intact (the server re-resolves ledger + GST rate from the catalogue), and it posts **no stock movement**. A manual charge row zeroes the subtotal and folds the GST into the ledger, destroying the input credit. `PURCHASE` is in `SERVICE_VOUCHER_TYPES`, so the same one ledger per service serves both sides — credited on a sale, debited on a purchase, so it nets to that service's own margin.

**Owner's rule: a service item needs no stock record.** Retired service products get `opening qty: null`, which lands `stock: 0` (`syncProductCacheFromOpening` returns 0, not null — true "untracked" has no API path).

How to apply: never reintroduce a service as a stock product. `unitPrice` = gross / (1 + taxRate/100), full precision. `roundOff` = total − Σ round2(net + tax) **per charge** — `chargesNetTotal` rounds per charge then sums, so rounding once at the end is wrong by a paisa.

Done for the 4 Vyapar service items on 17-Sep-2026: **21 purchase + 98 sale vouchers** converted to service lines — **zero service-product lines remain anywhere in the books**. POS vouchers 11 and 2409 were already correct and left alone. SV-930800-26 was converted last, once the branch backfill made it editable. All four products' stock set to 0. Trial balance level at 1,14,09,431.49. See [project_service_income_reclass](project_service_income_reclass.md), [project_vyapar_migration](project_vyapar_migration.md).
