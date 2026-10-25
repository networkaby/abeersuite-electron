# v1.16.13 [urgent]

Every counter should install this today. It makes POS bills safe against double saving on a slow network, fixes opening stock that was being counted twice, and adds a saved Round Off tick on vouchers. **This release changes the database** (a bill key on vouchers, the Round Off tick, and Head Office set on old opening stock) — counters must update first; the office site is updated after that, and a counter's sync pauses until it has this version.

## Billing (POS)
- A bill whose save was uncertain (slow or dropped network) is never saved twice — the counter sends one key per bill and treats "already saved" as done.
- A walk-in cash bill must now be paid in full before it saves.
- You can correct the cash count of any closed shift.
- Reopening a shift now finds the right later shift.

## Vouchers
- Round Off is ticked by default and rounds the final total.
- The Round Off tick is saved with the voucher, so a bill re-opens exactly as you left it; editing a saved voucher re-rounds automatically.

## Stock and opening balances
- A stock count no longer doubles the opening quantity; closing stock counts every product correctly.
- Opening stock is always saved at a branch — pick the stock location on the Opening Balance page and in its New product window. Old openings with no branch are put at Head Office.
- A rate-only product edit no longer wipes the opening quantity.
- A counter's sync no longer empties an opening stock's branch.
- Faster product create; a bulk save keeps the rows that failed so you can fix them.
- The products list loads page by page, while search and filters still cover every product.

## Photos and shop
- HEIC/HEIF photos from iPhones are stored as JPG.
- New "From library" picker reuses photos already uploaded, and a Photo cleanup button removes unused shop photos.
- Product page photos merge with the saved gallery and update live.

## Phone apps
- Staff app 2.3.0 and customer app 2.2.0 update inside the app — no Chrome needed.
- Take photo now opens the camera, not the gallery; phone photos retry and finish attaching when reopened.

## Everywhere
- Indian commas used everywhere for money.
- Three screens that read "today" in UTC now use the shop's day.
- Product search list is wide enough to show full names.
- Many screens tidied up for smoother, more reliable behaviour; settings saved in the browser are no longer lost.
- Security: the desktop app cannot be navigated to a foreign site; backups never send the database address outside.
