# v1.8.4

A quiet update for every counter and the office app. It fixes a stuck "Sync error" badge after an internet drop, shows the party's balance while taking a receipt, and fixes photo upload in the office app. No database change — install whenever convenient.

## Sync
- When the internet drops, saves waiting on the counter are no longer given up on. Earlier, a long outage could leave a red "Sync error" badge that stayed even after the line came back. Now those saves simply wait and go up once the connection returns.
- Counters that already show such a stuck error clear it themselves after this update.

## Billing (POS)
- The **Rcv** (receipt) dialog now shows the party's current balance, and what the balance will become after this receipt.
- The customer display's UPI QR now shows the amount just typed, not the previous one.

## Office app
- Photo upload (products, staff, etc.) now works inside the desktop office app.

## Sign-in safety
- Wrong codes on customer sign-in and staff password reset are now counted on the server, so nobody can keep guessing a code.
