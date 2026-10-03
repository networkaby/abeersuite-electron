# v1.12.0

Every counter can take this update at a quiet moment. There is no database change, so nothing needs to be done in a particular order. The big news is the new staff phone app.

## Staff phone app (new)
- Staff can now open AbeerSuite on their phone at `/m-staff-app` and install it like an app. A QR code on the Downloads page opens the install page directly.
- Look up stock and price, party balance and unpaid bills right from the phone. Search is fast because it uses the list already saved on the phone.
- Party screen shows its vouchers with a running balance (posted vouchers only), tells same-named parties apart, and has a Call button (for suppliers too).
- Tick unpaid bills on the party screen, then Receive / Pay opens with those bills ready. A typed amount fills the next open bill before any advance.
- Quick Receive / Pay entry and quick Expense entry (expense ledgers only) from Home.
- Side menu with sign out, receivables, payables and day book. A "Show suppliers" tick hides the supplier side, as the office does.
- Mobile App is now its own module in Roles and Departments, so you decide who gets it.

## Billing (POS)
- Payment-method discount: UPI and card can carry a smaller discount than cash. A big UPI amount can be taken in parts.
- UPI parts open beside the checkout, received parts stay fixed, and a tick marks only the part you pick.
- The list of payment methods at the counter now comes from Settings → Payment Methods.

## Accountancy
- Counter till cash is no longer offered on Payment / Receipt vouchers made outside POS.

## Development
- Phone on the shop Wi-Fi can open the dev server (developer use only).
