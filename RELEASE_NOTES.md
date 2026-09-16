# v1.3.8 [urgent]

Every counter must take this update **before** the office site is deployed. It carries a
database change on the Phone and Email tables, and a counter that is still on the old
version will stop syncing all its tables the moment the office side changes. Install it
today, on every till.

The version fixes a long-standing fault where a phone number corrected in the office
never reached the counter, brings credit limits to the till, and finishes the caller-ID
work on the EPBX line.

## A corrected phone number now reaches the counter

Until now only **new** phone numbers and email ids travelled down to a till. If somebody
fixed a wrong number in the office, or deleted one, the counter kept showing the old
value — forever. The hourly check could not catch it either.

- Phone and Email now carry a "last changed" stamp, which is what the sync uses to spot
  an edit. From this version a correction reaches every counter on the next cycle.
- On the first sync after the upgrade each counter pulls both lists once in full, so the
  corrections they have been missing all this time come down straight away.

## Credit at the counter

- **A credit bill is allowed up to the customer's credit limit.** The counter checks the
  limit at checkout instead of refusing credit outright, and the same rule is now
  enforced on office sales too.
- The customer's **master opening balance** is counted in the panel figure and in the
  credit check. Earlier it was left out, so a party with an opening due looked clearer
  than they were.
- A credit limit can be set from the customer screen through a proper dialog.
- The customer panel's **"Overdue" tile is now called "Unsettled"** — it always showed
  everything not yet settled, not only what is past due.

## Caller ID on the EPBX line

- **A half-arrived number is read as a part number**, not as an unknown outsider. Staff
  get a shortlist of who it could be and pick the right person; the call is then counted
  as completed.
- Staff can also **set the caller by hand** when the line gives the wrong number.
- A number arriving with a leading **91** is read as the country code and the ten digits
  kept.
- Follow-up reminders in the popup are **folded by caller**, so one person with five
  missed calls is one row, not five.
- **One EPBX extension may now sit on several counters.**

## Customers and parties

- The **Status column shows settlement** and opens the bill-wise popup.
- **Receipts appear on the Transactions tab**, and "Paid" is read from the ledger.
- Deleting an opening balance now needs the delete right, not the edit right.
- The party search box **searches the whole list**. Customers were being hidden from it.

## Accountancy

- **A receipt settles the bills it actually paid**, and editing a receipt keeps its
  tender tags.
- Both pending reports now read from one settlement calculation, so they agree.
- Group-tree totals are read correctly inside a transaction.

## Look and speed

- The module colour now carries across roughly ninety more pages — accountancy, the
  customer explorers, tabs and breadcrumbs — so you can tell at a glance which part of
  the suite you are in.
- The counter's sync-status and counter-status checks are **shared instead of repeated**,
  which cuts a steady stream of background requests.
- Signing in wakes the status panels straight away instead of after the next check.
- The tray menu shows the app version and what the update check is doing.
- Carried over from the last round: quick-create saves the sale price it was given, one
  UPI id rule at the counter and in party settings, clearer branch-access refusals, and
  the last native pop-ups replaced with the app's own styled dialog.
