# v1.14.0 [urgent]

Every counter and the office should take this update today. It adds due-payment reminders, customer WhatsApp replies on CRM, and the first version of the new customer shopping app. It adds new tables to the database. Update the counters first and deploy the office site after that. Until a counter updates, the new tables simply don't sync there. Billing is not affected.

## Due reminders

- New due reminder screens: send a reminder to one party, or to everyone at once, with DUE_SOFT and DUE_FIRM WhatsApp templates.
- Daily rules in Settings send reminders automatically. Parties still under a chosen % of their auto or manual credit limit are skipped.
- The owner gets a bell notification when the daily run adds names to the call list.
- Customers can pay their due by UPI from the portal.

## Customer messages

- When a customer replies on WhatsApp, the reply now shows on CRM → Messages, linked to the party just like phone calls.
- Opening a chat clears its unread badge. The Role page shows a "Can reply on WhatsApp" tick.
- WhatsApp Templates now works on the counter's office build too.

## Customer app and portal

- New customer shopping app: Home with banners, deals and categories, search, product page, cart, 3-step checkout, orders, bills, ledger, outstanding, repairs, wishlist, coupons, wallet and profile.
- My Coupons and My Wallet now show real shop coupons, loyalty points and gift cards.
- The app receives bill notifications as push messages on the phone.
- The portal is now built for phones first: bottom tab bar, slimmer top bar and a yellow "Visit our shop" button.
- Shop and portal pages on phones offer a "Get our app" strip.
- An order page now opens only for the customer who placed the order.

## Fixes

- Desktop Day Book hides the supplier side unless "Show suppliers" is ticked.
- On phones, the shop header no longer overflows, and the Sign in button no longer flashes while the session loads.
