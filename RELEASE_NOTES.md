# v1.11.0

Every counter should take this update. It changes the database, so please let every till restart on this version before the office site is updated. Until a till has this version, its voucher uploads can wait in its queue.

## Billing (POS)
- Edit a customer right from the counter. If you rename the customer, the ledger name changes too.
- Convert an open Estimate or Order into a bill from the mode dropdown.
- The customer panel now shows medals for each spend period. The tier colour shows on the medal border.
- Wider rate box on cart lines. The edit-customer window is also wider, with Advanced in two columns.

## Accountancy
- Day Book now converts Estimates and Orders. The old Orders & Estimates page is gone, and the sidebar link stays.
- Optional Vouchers report is removed. Day Book covers it.
- Some old pages that nothing opened are removed.
- A ledger made from a picker opens complete in the edit box.

## Contacts
- Office Profile shows "Verified" or "Not verified" on each phone number and email.

## Numbers and notes
- Voucher numbers now run per counter only. The old fallback count is gone, so a number is never repeated.
- A line note now has its own place, so a product name with " · " in it no longer loses a piece. Old notes are split once, only where it is certain.

## Sync and counters
- A missed edit from another machine now gets repaired by itself.
- The sync badge now shows real upload failures instead of always saying "reachable".
- Closing the app or shutting down Windows during a sync no longer leaves balances wrong. The next sync finishes the job.
- If the printer helper or sync helper crashes, it starts again by itself. Before, you had to restart the app.
- A till now sends only the columns the office knows, so a database clean-up can never block its queue.
