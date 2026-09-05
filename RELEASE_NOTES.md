# v1.0.0

A fresh start. The version number restarts at 1.0.0 — the old 5.x builds are kept on the
releases page under an "Archived" name, but no counter updates into this one. Install it by
hand on every machine. After this, updates go the normal way again: 1.0.1, 1.0.2 and upward.

**About the database:** this version adds a new table for the per-counter bill numbering.
The office server has already been updated with it, so counters can sync as soon as they are
installed. Nothing for you to do.

## Bill numbers

- Every counter now keeps its **own running number** for each voucher series. Earlier, two
  counters could hand out the same invoice number if they billed at the same moment and then
  synced — that cannot happen any more. The office counts as counter 1.
- The number format itself (prefix, year, padding, order of the parts) is still set once in the
  office and is shared by everyone. Only the running number is per counter.

## POS and billing

- A return can now put the money **back onto the gift card** the customer paid with.
- Cancelling a sale now **gives back the reward points** that sale had used up. Earlier those
  points were simply lost.
- Two returns landing on the same gift card at the same moment can no longer lose one of them.
  The database now adds the refund itself.

## Sync

- Running totals (ledger balances and the like) no longer travel between the counter and the
  office. Each side works its own total out from the entries it holds, so a slow or repeated
  sync can never leave a balance wrong.

## Online orders

- The advance money received against an online order is now recorded correctly, and the
  earlier wrongly-recorded ones are repaired automatically on this update.
- A receipt of zero value with nothing allocated is now accepted as normal instead of being
  reported as a problem.

## Backup and restore

- Restoring a backup now **stops everything that writes** to the database first, then restarts
  the app when it is done. Earlier a background job could write in the middle of a restore.

## Counter setup

- A counter PC that has not been given a counter yet can now only reach the onboarding page —
  it can no longer wander into billing with no counter set.
- A counter now picks up a new release the moment the office sends the signal.

## Roles and permissions

- Saving a role now **warns you** if a permission you had ticked was dropped, instead of
  quietly saying "saved".
