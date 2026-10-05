# v1.12.1 [urgent]

Every counter and the office should take this update. It makes editing an old POS sale safe: the payment, the shift cash and the shift report now stay correct after a sale is changed. No database change, but every counter should restart today so edited sales and shift cash stay correct.

## POS — editing a sale

- **Update Sale now takes the payment again, just like a fresh checkout.** You can change how the customer paid (cash, card, UPI and so on) while editing a sale.
- An edited sale keeps the offers, prices and loyalty points of the day it was first billed — not today's. Points and card amounts adjust to match the new bill.
- A sale always belongs to the shift whose till took its cash, so shift totals no longer drift when a sale is edited later.
- When you leave a sale you were editing, you go back to the screen you opened it from (or the tab closes) instead of landing somewhere random.

## Shift close

- If a sale is edited after its shift was closed, the shift report now shows that the cash changed after closing.
- The correction is posted automatically in the same save — no manual adjustment needed.

## Vouchers

- **Convert** (for example estimate to bill) now carries services, extra charges and per-line ₹ discounts across.
- Each line's rate after Convert is worked out exactly from its saved amount, so totals no longer change by a few paise.

## Phone app

- The app on a phone now looks and behaves like an installed app.
- If Chrome's "Desktop site" setting is making the app look tiny, the phone now tells the user how to switch it off.
