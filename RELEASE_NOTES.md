# v1.10.1 [urgent]

Every counter should take this update. It changes the database, so a counter's sync pauses until it restarts on this version. Please restart each till once today.

## Bill numbers
- Every voucher type now takes its number from its own series, so the same number is never given out twice, even after a bill is deleted.
- POS Estimate and POS Order get their own number series, in the same style as your POS bills.
- New year format in Settings → Year Ending: **Fiscal short (26/27)**, with a slash instead of a dash.

## Billing (POS)
- A customer with no credit limit now shows "no credit" instead of "Unlimited", which matches what billing actually allows.
- Offers re-check when you change shipping, a charge or the round-off.
- A line note comes back complete when you edit the bill, even if the product name has " · " in it.

## Stock
- Cancelling and restoring a voucher now reverses exactly the right stock rows, including free-issue items with zero rate.
- A Journal with stock items no longer leaves an empty extra record behind. Old leftovers are cleaned up.

## Bank reconciliation
- Auto-match pairs only entries with the same date and same amount. When the amount and reference match but the date differs, you get a link to fix the voucher's date.
- Bank lines dated before your books start are treated as part of the opening balance, so they no longer show as a false difference.
- The Balance column shows where the books and the bank stop agreeing, in orange so it stands out on ticked rows.
- Editing, cancelling or back-dating a voucher moves the reconciliation lock back only where needed, and your bank ticks are kept.

## Screens
- "Unsaved changes" asks only when you really changed something.
- Contacts, Ledgers, Pending Vouchers and the POS Sales Register no longer show an old page after you change a filter.
- Reports never show an older answer over the one you asked for.
- Dropdown lists stay open while you scroll them.
- A product or ledger created from one row shows up in every row straight away.
- Money boxes accept only a valid amount.
- One party's details never show under another party's name.
