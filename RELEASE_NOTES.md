# v1.16.5 [urgent]

Every counter should install this today. It changes how a till signs in with the office, and the office site will move to the new sign-in right after the counters have updated.

## Counter sign-in
- Staff login on the till now happens on the till itself, so it is quicker and works even when the office line is slow.
- Each counter now has its own private key to talk to the office. No installer carries the office password any more. The key renews itself every 30 days; an admin can cut off a counter from **Admin → POS Counters**.
- **Sign out** now ends only that login, not every login of the same staff.
- Fixed the brief "log in again" flash right after signing out.

## Attendance and pay
- Attendance counts whole minutes. The day card lists On duty / Off duty in order, in two columns, and hides empty rows.
- A day's extra time first covers that day's late penalty and any earlier short time; only what is left is paid as overtime.
- Half days are judged against half the duty. Their extra time recovers short time, and the rest is paid at the normal rate, never as overtime.
- Full-day and half-day limits can be edited on **Pay Rules**.
- Employee Activity now checks every clocked day, Manual or Auto. Over / short matches the day's own total.
- When the office marks someone late, the day card says why.

## Sync
- An attendance mark made in the office no longer wipes the minutes the till recorded.

## Important — update order
This version adds new fields for counters. **Update every counter first.** The office site is updated after that; a till still on the old version will pause its sync until it updates.
