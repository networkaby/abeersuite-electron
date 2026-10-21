# v1.16.11 [urgent]

Every counter should install this today. It makes counter sync more reliable (bills and their lines now always arrive together), fixes the QR display retry, and brings the new staff and customer phone apps (2.1.1). There is no database change in this release.

## Sync
- A counter no longer marks a bill, voucher or order as synced until all of its lines have arrived too. If lines are missing, the counter pulls them again until they are in.

## Counters
- If the customer QR display is not plugged in, the counter notes it once and quietly checks again every minute, instead of filling the log.
- Bank reconciliation and party merge no longer fail now and then while saving.

## Accountancy and payroll
- The next voucher number and credit days now follow the voucher type you pick.
- The Branch filter now works on the GL and Journal registers.
- The salary "who is owed" list counts the opening balance, and a staff name on the Pay tab opens their salary ledger.
- A delivery challan printed with "Show prices" off shows only the goods and quantity.

## Online shop and AI descriptions
- The AI descriptions screen works on one set of products at a time, and has the same product filters, a photo strip and Tick all / search on one row.
- AI writing uses free keys in turn and only uses the paid key when you turn on "Use Premium API" (off by default). A busy key rests for a short while instead of locking you out for the day.
- A new AI Setup page in Settings (preview only for now). The browser no longer fills your saved login into the AI key boxes.
- The shop footer links to the company site, and opening hours are shown as Sat–Thu 10 AM – 8 PM, Friday closed.

## Phone apps (2.1.1)
- In the staff and customer apps, the phone's Back button now goes back through the app's pages instead of closing the app. Phones will be offered the update.
- The WhatsApp and + buttons can be dragged separately and no longer overlap.
