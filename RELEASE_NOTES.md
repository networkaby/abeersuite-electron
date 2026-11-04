# v1.16.25

An important update — it carries a database change, so every counter must take it before the office site is updated. The counter will show the countdown and restart itself at a free moment. Until a counter is updated, its sync pauses once the office side changes.

## Billing on the counter

- **The lowest price is now a safety wall.** Every discount comes off the barcode (Public) price and stops at the lowest price — a bill can no longer go below it, even if typed by hand. The server also refuses such a line.
- A line now shows half the gap between the barcode price and the lowest price, so staff can see how much room there is to bargain.
- A hand-typed round-off is held to ±₹1.

## Update Prices screen

- Column names are clearer: Sale Price now shows as **Fixed Price**, Barcode as **Public Price** (with a barcode icon).
- Barcodes are typed by hand only — the Update barcode button is gone, MRP or Sale Price changes never move a barcode, and a barcode is never saved below the lowest price.
- Every edit (Computed, Sale Price, MRP, barcode) waits for **Save prices**; Save prices no longer asks for a confirm and clears the ticks after saving.
- A reset-all circle beside the header tick undoes unsaved edits.

## Coupons and discounts

- **Private coupons** replace Single-use: a private coupon is hidden from the POS, app and shop offer lists and works only when its code is typed. Use limits come from the total and per-customer limits.
- Coupons and spend tiers each get their own discount cap, plus the shared overall cap — on all three discount pages.
- The coupon form is wider, with clearer Behaviour wording, one switches card and a Help button.

## Other

- **Team chat** can now send files — Excel, PDF and photos.
- Products list has a **Photos** count column and a filter by number of photos.
- Social posts with photos stay a draft until the photos finish uploading, then schedule themselves.
- Counters use less internet while syncing.
