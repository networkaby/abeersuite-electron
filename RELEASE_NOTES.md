# v1.3.0

Install this on every counter. It starts a till that has stopped on the red "This counter needs an update" screen, and it carries a set of sync repairs that keep each till's copy of the data honest.

**About the stopped counters:** the office server has gained two new fields — the till that raised a voucher, and the till that raised a ticket. A counter whose own copy of the data does not have those fields stops copying and pauses billing on purpose, rather than saving against records it does not fully understand. That is the red screen. This version gives the counter the matching fields, so copying starts again.

## Stopped counters

- A till showing "This counter needs an update" works again after this install. Its own copy of the data is rebuilt with the fields the office added, and copying carries on by itself.
- A till in that state fetches this update on its own, and installs it about five minutes later. Nobody has to walk to the machine.

## Bills and the Day Book

- Every bill, receipt, expense and repair ticket now records which till raised it. An entry made at the office shows as an office entry — that is a real answer, not a blank.
- The POS sales register has a new "Only this counter" tick, on by default, so a cashier sees their own till's sales.
- The sales register and the Day Book are now ordered by the date on the entry. Before this, bills a till saved while offline jumped to the top when they finally reached the office, above sales made days later.

## Sync

- Counter screens no longer lose rows. A row that reached the till's copy just after the screen last asked stayed hidden until somebody pressed Refresh.
- Moving a card on the Help, Deals or Tasks board no longer makes it jump back to its old place for a few seconds.
- The system now finds and repairs rows that had quietly gone out of step with the office. One customer record had been wrong on a till for six weeks with nothing noticing it. Checking and repair now compare what is inside the row, not only its number.
- A till no longer knocks every five seconds on a database that is not running, and says the real address when it cannot reach one.

## Counter saving

- Under office saving, a till now sends every save to the office, not only the common ones. Removing a customer record the office had already removed no longer fails at the till with an error.
- The top bar now says **W:Office** while saves go through the office. It used to say "Live", which read as if the till were writing to the internet database itself.

## My Profile — customer website

- Customers can now see and change their own photo, name, address, mobile numbers and email addresses from My Profile.
- A customer who shops for more than one person or firm can choose which profile they are shopping with, from a "Using: <name>" chip in the header and at checkout.
- A mobile number or email a customer adds themselves stays unverified until it is confirmed by OTP. Staff can still find the customer by it at the counter, but until it is confirmed it cannot be made the main number, and it cannot be used to sign in or to reset a password. Anything staff entered counts as verified already.
- Company details stay read-only in the customer website.
