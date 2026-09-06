# v1.1.0

Printing across the counter now works more smoothly — receipts and vouchers print straight to the printer without a preview window popping up, and the printed paper matches what you saw on screen.

## Printing
- POS reprints, and Receive / Expense slips, now print silently — no popup, no extra click.
- Voucher forms (General, Journal, Trading, Branch Transfer, Manufacturing, Physical Stock) print silently right after you save, when "Thermal" is ticked.
- The "Print (thermal)" option on the 3-dot menu now prints silently, same as a POS sale.
- Fixed: thermal receipts were printing on a full A4-size page, leaving most of the 80mm roll blank — now sized correctly for the roll.
- Fixed: thermal receipt preview now matches the actual printed paper — bigger brand name, plain amounts, barcode caption, and long names wrap properly.
- Fixed: the "Header text" setting no longer accidentally hides the brand name on thermal receipts.

## Templates
- Coupons and gift cards can now be customized through the print template settings, same as invoices and other receipts.
- Shipping labels now pull sender name, footer, and which fields to show from the template settings.

## Other
- Fixed a small glitch in the uninstaller.
