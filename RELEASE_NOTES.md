# v1.3.9

A quiet update, worth taking on every counter. The main thing: a party's statement at the till now keeps itself up to date, so the Status you see is the Status the books say. Also, unpaid bills can now be linked to money that is already sitting unlinked, straight from the Receivables and Payables reports. Nothing in the database changes, so counters and the office can be updated in any order.

## Customer statement updates by itself

Until now, a receipt made at Head Office reached the counter's own copy of the data within seconds — but the screen went on showing the old figures until somebody pressed **Refresh**. A bill could read **Due** when the money against it was already linked.

The party's **Transactions** tab now follows the books on its own, on both the Person and the Company screens. It updates only after the counter's copy has really received the rows, so it can never show a half-finished picture, and it refreshes quietly — the table you are reading is never replaced by a loading circle.

Every screen in the app that already updated on its own now does so more cheaply too: looking away from the window and back again used to cost two readings instead of one.

## Link a bill to money already received — from the reports

On **Receivables**, **Payables**, and a party's **Outstanding** tab, the Status of a bill (`Within 12d`, `Overdue 138d`) was only text. The only button on the row made a **new** receipt or payment — no use when the customer has already paid and that receipt is sitting unlinked as an advance.

That Status is now clickable, with a small chain mark. It opens the same bill-wise link window the customer's Transactions tab has always used — tick the bills, put a part amount, or press Auto to clear the oldest first. A bill that gets settled leaves the list at once instead of sitting there stale.

## Inventory hub — five dead cards fixed

On the **Inventory** home page, five of the six cards led to a "page not found": Units, Categories, Groups, Brands and Warranty terms. Only Products worked. All of them open correctly now, and three masters the hub never showed at all — Attribute masters, GST Rates and BOMs — have been added. The page now reads the same list the sidebar uses, so the two can never disagree again.

## Easier to move around

- All **21 Business Intelligence** pages now show a breadcrumb at the top, and **Esc** takes you back — they had neither before.
- The app's own shell pages — the home dashboard, the Workspace inboxes, a colleague's profile, the serial lookup — now carry their own light colour instead of none, so it is clear at a glance that you are outside a business module. **Esc** goes back on those too.
- The app and tray icon now sit on a white square, so it stays readable on a dark taskbar.
