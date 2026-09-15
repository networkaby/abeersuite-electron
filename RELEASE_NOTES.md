# AbeerSuite 1.3.8

A few real fixes this time — install whenever convenient, nothing urgent.

## Fixes you may have hit

- **Quick-create was silently dropping the sale price you typed.** Creating a
  product from the quick-create box (instead of the full New Product form)
  saved the product but never the price you entered — the pricing engine
  quietly filled in something else instead. Fixed: the price you type is now
  the price that gets saved, including a genuinely free item priced at ₹0.
- **A valid UPI ID could get rejected at the till.** Some real UPI handles
  (like `name@pay.tm1`, with a digit or dot after the PSP name) were accepted
  in party bank details but refused at the counter's payment screen. Both
  places now use the same rule, and a pasted ID with a trailing space is no
  longer rejected either.
- **"You don't have access to that branch" now actually shows up.** When a
  branch-access refusal happened, the screen was supposed to show that exact
  message but silently showed nothing useful instead. It now displays
  correctly everywhere this check applies.

## Behind the scenes

A batch of internal cleanup landed alongside these fixes — shared helpers for
confirm dialogs, avatars, date formatting, rupee-to-paise parsing, and the
sync delta format used by a few admin/office boards. None of this changes how
anything looks or behaves; it just means less duplicated code to go wrong
next time.
