# v1.7.0

This version brings **HR & People** — a new menu in office where staff records, attendance, leave, holidays and monthly salary all live together, and salary is posted straight into the books. Everyone should update. Counters must be updated **before** the office site is deployed: the till learns about the new attendance tables from this build, and it marks attendance itself once it has them.

## HR & People — new menu
- **Staff Directory.** One record per person, with their own ledger, read in five easy columns instead of eight. Open anyone's profile straight from HR — no more going the long way round through Administration.
- **Staff profile.** Everything about one person on one page, including their own salary slips, which the staff member can now see for themselves.
- **Attendance register.** A month view of who came and who did not. The counter marks its own attendance when a person signs in at the till — nothing to fill by hand.
- **Holidays.** Keep the shop's holiday list, so those days are not counted against anybody.
- **Leave.** Staff leave is recorded here and taken into account when salary is worked out.

## Payroll
- **Monthly payroll run.** Generate the payable for a date range, check it head by head, and post it once. Salary is proportioned by the days actually worked.
- **Pay many staff from one screen, in one voucher** — instead of a separate payment for each person.
- **A posted run can be cancelled**, which frees those days again for a fresh run.
- **Salary expense is now one ledger for the whole shop**, not a separate expense ledger per person — far less clutter in the chart of accounts.
- The payroll page holds its shape while it loads, so nothing jumps under your cursor.

## Fixes
- The shift closing slip prints the real amounts. It was printing zeros.
- Signing in at the counter no longer rewrites the arrival time already recorded for that day.
- The Staff Directory was clipping about 63 pixels off its right edge.
- The expense-ledger picker shows the ledger itself when closed, not the group it sits under.

## New tables — update counters first
This release adds attendance, holiday, leave, staff and payroll tables. They are all brand new, so a counter still on the old version will keep syncing as before. But install this build on every counter **before** the office site is deployed, so each till has the new tables ready when they start filling.
