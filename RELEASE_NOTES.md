# v1.16.10 [urgent]

Every counter should install this today. It brings a printed slip for counter returns, cleans up repairing and pricing, and fixes AI image download on the till. This release changes the database (the old price lock and the old service centre list are removed), so every counter must take this update before the office website is updated.

## Billing and printing
- Counter returns now print their own **return slip**, and its layout can be changed in the print template like every other document.
- When a POS order turns into a sale, any rewards held on that order are now used up correctly.

## Prices
- The old manual price lock is gone. Every product that was locked keeps the exact price it sells at today — now kept as its saved (barcode) price — so no customer price changes.

## Repairing
- A service centre is now simply a supplier party, picked from the party list on the shipping slip and on Escalate. The separate Service Centre list is removed.

## Delivery
- The old "Pickup" delivery carrier is removed for good.

## Counters
- Downloading AI product images now works on the counter.

## Phone apps
- Staff and customer apps stay signed in, and the install page offers the update.
- Customer app build 4: sign in with Google inside the app, and a "Get our app" link on the shop website (shows a QR code on a computer).
- Product and party lists on the phone load faster: only the last 15 days of changes are fetched, and saved rows show first.

## Online shop
- AI product copy now reads every photo of a product, unless staff mark a photo "Skip for AI".
