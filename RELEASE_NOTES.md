# v1.8.1 [urgent]

Every counter should take this update today. It changes how a cashier hands the drawer to the next person — the whole drawer now moves in one step at the counter's sign-in screen — and it fixes counters that stopped syncing after the last database change. **This version changes the database** (the cashier handover record). The office side already has the change, so a counter still on v1.8.0 may have paused its sync; installing this version brings it back.

## Cashier handover

- **Hand over the whole drawer.** The cashier going off duty counts the drawer (notes and coins) and signs out — no need to pick the next cashier or keep a float aside.
- **The next cashier sees it at sign-in.** Before the app opens, the counter shows whose drawer is waiting, the expected cash and every payment method collected. **Accept** takes the drawer and goes to POS; **Reject** signs out again.
- A cashier who simply signs out without counting leaves the shift open, and whoever signs in next can review and take it over.
- **Hand over** is now its own button beside the shift pill in the POS top bar. **Close shift** is only for closing the day into the vault, and its screen is larger with a clear "hand over to vault" line.

## Counter sign-in screen

- One tidy till card: next duty day and time up top, today's duty below it, then the drawer with the cash figure to check and every payment method the counter takes — even on a quiet day with nothing collected.
- The cards now sit level with the sign-in box instead of squeezing the showcase.
- The day's status reads plainly: **Duty joined** when the cashier worked but stayed under half a day, **Absent** when they did not come.
- Sign-in on a counter is quicker — the checks now run side by side.

## Bill numbers

- A bill takes its number from the counter it was raised at, whether the counter is working offline, online or through the office.
- The office resetting or rolling a counter's numbers into a new year is no longer undone by the counter's next sync.
- Shift difference journals and gift-card vouchers now get a number like every other voucher.

## Shifts

- A shift can be deleted as soon as no bill, receipt, expense or cash drop is on it — POS sales included. The screen names what is blocking it. Deleting a shift also removes the handover it gave or received.

## Fixes

- Counters no longer halt with "schema drift" after the handover change — their local copy now accepts the new optional fields.
- When any window of the app goes back to sign-in, every other window it opened (such as a POS tab) closes too, so no one is left looking at a signed-out cashier's open shift.
- Worked time in HR now counts correctly for tills that are online through the office — it was showing 0m.
