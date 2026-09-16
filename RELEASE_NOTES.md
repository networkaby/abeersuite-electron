# v1.3.9

A quiet update, worth taking on every counter. Two things run through it. First, screens stop emptying themselves: a table you are reading is never torn down and rebuilt just because the books moved or you pressed Refresh. Second, unlinked money is now visible and linkable wherever you meet a party — the reports, the party list, and the party's own screen. Nothing in the database changes, so counters and the office can be updated in any order.

## Screens stop going blank while you read them

A table you can already read is never replaced by a loading circle any more. Before, a re-read of any kind — a voucher posted at another till, a date changed, the Refresh button — threw the rows off the page, dropped a small spinner in the hole, lost your scroll position, and then built the whole thing again.

This is fixed everywhere it was happening:

- **All 22 voucher registers** — sales, purchases, journal entries, orders and estimates and the rest. Posting a voucher at a till no longer flashes the register somebody else is reading.
- **The party's Transactions statement**, on all three customer screens. Saving a bill-wise link used to blank a full page of rows.
- **The Business Intelligence home page** — changing the date kept the KPI cards, the charts and the report list on screen. It also gained the retry and the "these are the last good figures" note the other BI pages already had.
- **Costing**, under Pricing Strategy.

The spinner now means only one thing: there is genuinely nothing yet to show. A Refresh says so in its own button — the icon spins and the button greys out while the reading is on — instead of by tearing the page down. Registers got a proper Refresh icon for the first time.

## Customer statement updates by itself

A receipt made at Head Office reached the counter's own copy of the data within seconds, but the screen went on showing the old figures until somebody pressed Refresh. A bill could read **Due** when the money against it was already linked.

The party's **Transactions** tab now follows the books on its own, on the Person, Company and All screens. It updates only after the counter's copy has really received the rows, so it can never show a half-finished picture, and it refreshes quietly over the rows already there.

A link saved on a party's **Outstanding** tab now reaches the **Transactions** tab beside it, and the other way round — the two tabs no longer disagree about the same bill. A link made on **another counter** reaches both as well; that signal used to be dropped when the tab was closed.

Every screen that already updated on its own now does so more cheaply too: looking away from the window and back again used to cost two readings instead of one.

## Money waiting to be linked now shows itself

A receipt is never a bill, so a receipt that has not been put against any bill sits in the ledger but nowhere in the bill list. That is why a party's balance can disagree with its outstanding without a single bill being unpaid — the gap is unplaced money, not an unpaid bill. Until now there was no way to see that except by opening every row.

- On **Receivables** and **Payables**, the chain mark now appears only on the rows that really have something to link. Earlier every row carried it and most of them opened to "nothing to link here".
- In the **party lists** — Person and Companies, where you actually go looking for a customer — a broken chain in amber sits beside the balance when that party has money waiting to be linked. The amount is in the tooltip.
- A party's **Outstanding** tab opens with one line saying where it stands: amber with the amount to link, or green when everything is placed.

Overdue and unlinked stay separate: a party can be long overdue and still have nothing to link.

## Link a bill to money already received — from the reports

On **Receivables**, **Payables** and a party's **Outstanding** tab, the Status of a bill (`Within 12d`, `Overdue 138d`) was only text, and the only button on the row made a **new** receipt or payment — no use when the customer has already paid and that receipt is sitting unlinked as an advance.

That Status is now clickable. It opens the same bill-wise link window the Transactions tab has always used — tick the bills, put a part amount, or press **Auto** to clear the oldest first. A bill that gets settled leaves the list at once instead of sitting there stale. Receiving fresh money is still in the same window.

## Inventory hub — five dead cards fixed

On the **Inventory** home page, five of the six cards led to a "page not found": Units, Categories, Groups, Brands and Warranty terms. Only Products worked. All of them open correctly now, and three masters the hub never showed at all — Attribute masters, GST Rates and BOMs — have been added. The page now reads the same list the sidebar uses, so the two can never disagree again.

## Easier to move around

- All **21 Business Intelligence** pages now show a breadcrumb at the top, and **Esc** takes you back — they had neither before.
- On the **Bill Profit** report, opening a bill to see its detail could put the detail against the wrong row. The rows are now kept straight.
- The app's own shell pages — the home dashboard, the Workspace inboxes, a colleague's profile, the serial lookup — now carry their own light colour instead of none, so it is clear at a glance that you are outside a business module. **Esc** goes back on those too.
- The app and tray icon now sit on a white square, so it stays readable on a dark taskbar.
