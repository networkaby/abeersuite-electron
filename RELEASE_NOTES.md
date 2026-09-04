# v5.0.3

Fixes counter setup on a fresh PC, makes the Offline Policies page real, corrects who system messages and online receipts are attributed to, and brings live updates to every register, book and board. Install it on any counter that got stuck on the "Counter Setup" screen after 5.0.2.

**This version adds one table (Offline Policies).** The server database must have it before counters update, or their sync pauses until it does.

## Counter setup on a new PC

- **Setup no longer sticks at "Save and Continue".** On a clean Windows PC the local database could not start because a Microsoft runtime (Visual C++ 2015-2022) was missing. The app quietly fell back to the server, and the counter wizard could never prepare its local copy. The installer now checks for that runtime first and downloads it from Microsoft when it is absent, so a fresh PC comes up with a working local database.
- **The web setup does the same check** before it starts the installer, so whichever one you run first takes care of it once. No extra size in the installer: the runtime is only fetched when a PC actually needs it.
- **A clearer message if it still cannot start.** The app log now names the missing runtime and where to get it, instead of a bare error number.

## Offline Policies

- **The Offline Policies page now works.** Its toggles used to be saved only on the browser and changed nothing. They are now one setting in the database and are enforced on every counter: which vouchers, master data and repair tickets may be created or edited while the shop is offline. If the setting cannot be read, the built-in safe defaults apply.
- **A counter cannot loosen its own offline rules.** The policy is set from the office only and flows down to counters.
- The message a cashier sees when a ticket is refused offline now reads as a plain sentence.

## Who gets notified, and whose name goes on a receipt

- **System messages reach the right people.** New shop order, order paid, confirmed, dispatched, courier booked, courier booking failed, delivery failed and return posted were going only to the first admin. They now go to everyone who holds the duty by their position.
- **Online-payment receipts carry the right creator.** An auto-posted receipt used to be attributed to whichever user was created first. It now names the admin who holds that role.
- **Voucher references use the counter number.** The counter part of a GL voucher reference was taking the creator's user id, so the same series looked like two different counters depending on who saved it. New references now carry the real counter number. Already-posted vouchers are not changed.

## Live updates everywhere

- Every voucher register, cash, bank and loan book, GST report, Day Book, POS sales register, contacts, coupons, gift cards, tiers and the other boards now refresh on their own when another counter posts. No F5, and a refresh never blanks a screen you are reading.
- The Refresh button on the books and GST reports, which had stopped responding, works again.

## Build

- A developer's local web-testing settings can no longer leak into a counter or office installer. Only the desktop configuration is read when an installer is built.
