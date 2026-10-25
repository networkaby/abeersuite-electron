# v1.16.14 [urgent]

Every counter should install this today. It adds the new product Collections list, which the office site will start using soon — counters must be on this version before that goes live, or their sync will pause.

## Products and Collections

- "Category" is now called **Collection** on every office screen.
- A product can now sit in **several Collections**. Its first one stays the main Collection, so prices, loyalty, coupons, POS and reports work exactly as before.
- Opening Edit product no longer changes the product Name by itself.

## Online shop product form

- Pick Group and Brand right on the shop product form; the product Name rebuilds itself from them and shows live in the header.
- Pick Collections on the same form. The form is packed tighter — SKU, Group, Brand, Slug and Collections fit in a few rows.
- **Photos only** runs Photo AI on its own, reusing the last search, and tells you when it did.

## Reliability

- Photo storage reads and uploads now give up after a timeout instead of hanging the screen.

## For the office

This release adds a new database table (product collections). Update every counter first; push the office site only after the tills have restarted on v1.16.14.
