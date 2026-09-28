# v1.9.0 [urgent]

A feature update for every counter and the office app — install it today. It adds an Ads page for the online shop, a bank deposit slip for cash paid to a party, and a fix for counters that showed a stuck "Sync error". There is a database change in this one, so counters update first and the office website after — a counter that is not updated will pause its sync until it is.

## Database change
- Two small changes: the online shop gets a place to keep its ads, and converting or merging a party no longer leaves a hidden old copy behind.
- Sequence: counters update first, then the office website. Nothing to do by hand.

## Accountancy
- A cash payment to a party now prints the **Bank Deposit Slip** with the party's own bank details, a "Paid to" line and the note count. Count the notes on the Payment screen; Save waits until the count matches. If the party has no bank account on file, you get a normal voucher with a small "No bank details" warning.
- The amount of a counted cash payment now comes from the notes you count.
- The side column with open bills no longer runs off the bottom of the screen; it scrolls on its own.
- Typing a smaller amount no longer un-ticks bills that a party's advance or credit was already covering.

## Billing (POS)
- POS bills now print Received, **Balance due**, and the party's Previous / Closing balance, the same as a Sale — on A4 and on 80mm. An overpaid bill, or a credit bill paid later, no longer prints as fully due.
- The "Party balance" option now works on POS bills too (never for walk-in customers).

## Customers
- Converting a Person to a Company (or back) and merging duplicates now leave no old copy behind. All bills, tickets, notes, phones and emails move to the surviving party, and the old Trash section for them is gone.

## Online shop
- **Ecommerce → Ads** is new: put your own ads in the empty spaces of the shop — picture ads with a link, or product ads drawn from your catalogue. Set size, dates and priority; every ad shows a "Sponsored" tag. Add `?adPreview=1` while signed in to see where ads would appear.
- Customize Home: **Unlock** now opens all fallback sections at once, and fallback sections can be duplicated. New permission "Can unlock fallback" on the Role page.

## Sync and sign-in
- The stuck "Sync error" badge some counters still showed after 1.8.4 now clears itself; the retry keeps going until the counter's local database answers.
- A window you are not using no longer signs you out of the one you are working in.
- When a session is ended by an admin, the counter no longer loops through the login page, and Sign out stays signed out.

## Office app
- Back up now works from the desktop app.
- Me → Security → Forward Email and courier prices work inside the desktop app.
- Payment Methods in the desktop app now says the keys are checked on the office website instead of "Keys missing".
