# v1.16.15 [urgent]

Every counter should install this today. It brings the database changes for scheduled campaigns, post reminders and email templates, and a counter that has not updated will pause its sync once the office site goes live with them.

## Database update — counters first

- This version adds new columns (campaign schedule time, post reminder time) and new tables (email templates, email log, saved shop carts, email unsubscribe list), and removes the old stored account balance.
- Update every counter **before** the office site is deployed. A counter left on the old version stops syncing until it updates.

## Campaigns

- A campaign can now be **scheduled** for a later date and time instead of sending at once.
- The **Scheduled** page shows everything due on every channel — WhatsApp, email and posts — with a new timeline view, and Refresh reloads the timeline too.
- Due Reminders and Shop Ads now live under Campaigns.
- Staff get a push reminder when a post is due to be shared, repeated until it is posted.

## Email

- Customer documents can be emailed automatically, and **Send email** is back in the 3-dot menus.
- Editable email templates for repairs, due reminders, abandoned carts, pending payments, welcome mails and sign-in / password-reset codes.
- A failed email is retried on the next save.

## Billing and payments

- A customer's advance can pay the bill directly.
- **Share UPI QR** sends a WhatsApp "Pay now" request with the QR as a photo, from the shop's number.
- Money now shows the currency symbol set in Org Defaults, and thermal slips print the ₹ sign.

## Behind the scenes

- All scheduled jobs (messages, posts, reminders) now run from one timer, and backup failures are logged with their reason.
