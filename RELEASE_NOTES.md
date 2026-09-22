# v1.8.0 [urgent]

Every counter should take this update. It brings the full HR side of the shop — duty time, leave, pay rules, salary slips and commission — plus fixes for parties, costing and roles. **This version changes the database.** Update every counter first; the office site is switched over right after, and a counter left on the old version pauses its sync until it updates.

## Duty time and attendance

- The working day is now measured, not assumed: a staff member's duty is counted up to their last keypress, and idle time is left out.
- Each person can have their own office hours and their own idle limit. The register shows who came in late.
- Shop hours follow the season — summer and winter opening times — and at sign-out the till tells the counter hand when to come back.
- A counter hand can see their own day at sign-out, and the day card breaks the day into every stretch they were active.
- Till days that were missing an arrival time have been repaired, and a till day can no longer be marked present without one.

## Leave

- Leave types are now master data, each with a quota you can set. The quota warns when a leave is asked for, shows when it is decided, and cuts pay when it is exceeded.
- A leave must be asked for with the required notice (sick leave excepted), and the date box will not accept a date the notice rule forbids.
- Absence without leave is recorded and charged.

## Pay rules and salary slips

- A new Pay Rules screen: a salary buys 26 days, a day off worked is paid in hours, and a late day can be cut in time or as a percentage in slabs.
- The salary slip prints — a summary of the month with the accounted hours shown in days; the day-by-day detail moves to My Info.
- Whether the slip shows attendance and commission can be set in the print template.
- A payroll run whose journal was deleted no longer looks posted, and can be thrown away.
- Holidays can belong to one branch.

## Targets and commission

- Set commission heads once — who they are for, a flat rate or a slab ladder — then give a person their own rate where needed.
- Targets the app cannot count can be entered by hand.
- Commission is worked out for the month and paid on the payslip.

## Staff pages

- My Info: a staff member's own page, opened with one tick.
- The staff directory opens like the cash book and each row says where the person stands.

## Sign-in

- A session now ends overnight, so each morning starts with the PIN, and a session that ends tells you why.

## Parties, accounts and costing

- A converted or merged party still opens from every old voucher, and keeps its ledger when saved again.
- Every group drill-in now lands on Group Report.
- No more bill-link popup after saving a voucher.
- The costing voucher picker shows the real item count, has a "last N days" filter, and no longer spills out of its popup.

## Roles

- A permission you tick on the Role page is always saved; the department basket is for display only, and the page now says so.
