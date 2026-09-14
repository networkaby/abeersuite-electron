# v1.3.6

Fixes for voucher links and the till balance, plus two counter setup improvements. Everyone should install this one — the till balance fix affects every counter's shift open/close numbers.

## Schema change — update the counter after deploying

This release drops a database index (a counter's EPBX extension is no longer required to be unique, since a counter can now have more than one). **Deploy this build to Supabase/Vercel first, then update each counter within a few minutes** — until a counter updates, its sync pauses and it will show `SCHEMA DRIFT — refusing to sync` for every table, not just this one.

## Billing and vouchers

- Three places in the app (the Accountancy voucher link, Bill Profit, and the Account Ledger row menu) could open the wrong inventory voucher, or fail to open one at all with "Failed to load voucher for editing." All three now open the correct voucher, and Cancel/Delete/Print in the Account Ledger menu are fixed along with it.

## Till and shift accounting

- The cash shown at shift open (carry-over), shift close (expected in drawer), handover, and on the counter board could disagree with what the ledger actually shows, because these all read a cached balance that could drift out of sync. They now read straight from the posted ledger, so the numbers always tie out.

## Counter setup

- A counter can now be given more than one EPBX extension (phone number), separated by commas — useful when a counter answers calls on two lines.
- Right-click on any sidebar link now offers the same "open in new window" quick-action menu.
