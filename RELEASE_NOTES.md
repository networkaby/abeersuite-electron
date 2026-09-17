# v1.4.1

An office-side release. Nothing on the counter changes, and there is no database change — counters can take it whenever they restart. Worth installing for anyone who closes shifts, works the Day Book, or reads the Payables / Receivables reports.

## Shift close

- The close dialog now shows two equal boxes — **Hand over to vault** and **Keep in counter**. Fill either one and the other fills itself from the physical count, so the cashier can count out whichever pile is smaller.
- A bold **Contra to vault** row states the exact amount being posted, with the day's safe drops listed under it — that cash already left the drawer earlier in the day and must not be counted again.

## Day Book

- New **Unpaid only** filter. It shows just the bills still due or part-paid, and paging through them stays gap-free. A bill that gets paid off drops out of the list on its own.

## Bill-wise linking

- The link chip now only appears where there is actually something to link to. A due row whose party has no unplaced money on the other side shows a plain word instead of a button that opened an empty popup. This holds everywhere the chip is shown — Day Book, the GL, inventory and journal registers, and the party's Transactions tab.
- The open-amount lookup behind it was doing its arithmetic in the app after reading every ledger line. It is now one database query. A page of forty parties used to take about ten seconds; it is now near-instant.

## Payables / Receivables reports

- Party names in both tabs are now real links and open the party's page.
- Right-click anywhere in the report and you get **Open in new window** for whichever link is under the pointer — party names and bill references alike.
