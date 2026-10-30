# v1.16.20

A customer and accounts update. Counters can take it at a quiet moment. This version adds one new database table (customer addresses). Older counters simply ignore it, so nothing pauses, but please update counters before the office site goes live with it.

## Customer addresses

- A customer can now keep more than one delivery address. Staff add the first one from the customer's profile in the office; the customer can add more from the app or website.
- The main address is still the one printed on bills.
- At checkout on the shop website and app, the customer picks from their saved addresses. It opens on the address they used last, and the address they ship to is saved for next time.

## Bank reconciliation

- Bandhan Bank CSV statements are now recognised on import.
- When a statement's account number does not match, the message now shows both full account numbers so you can see which is which.
