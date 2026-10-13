# v1.16.4 [urgent]

Every counter must update today. It changes HR attendance and payroll, and makes sure changes made in the office reach every counter. This version adds a database change, and the office site is being updated with it. A counter that has not updated will have its sync pause.

## HR – Attendance and Payroll

- Day review now has an Auto / Manual toggle instead of Accept / Reject.
- Auto attendance reaches pay only after it is accepted. Day review is on Employee Activity, and each row opens that person's day card.
- The day card now refreshes when you mark a day or switch to another day. The hour and minute boxes are wider.
- Figures on the activity card can be corrected.
- Payroll "Generate" now opens on From / Till, covering every unpaid day up to today.
- A payroll run opened before the counter has it now waits, instead of saying "not found".

## Sync

- A change made only to a bill's lines or other child details now reaches every counter. Earlier it could be missed.
- HR payroll, payslips, leave types, loyalty wallet and POS positions now update on screen as soon as new data arrives.
- Sync keeps its connections ready between cycles, so it runs faster.

## Messages and Recycle Bin

- The first reply after a bill no longer shows a menu, and Close clears the popup.
- Recycle Bin: View opens a read-only look inside any saved voucher copy. It opens wide, up to 95% of the screen.
