# v1.17.2

Every counter should install this one. It adds product variants and an Attention stage for shop products, which changes the database — **update every counter first**; a counter that has not updated pauses its sync until it does. It also fixes a crash when adding an item to the cart on POS.

## Point of sale

- Fixed: adding an item to the cart could crash the billing screen after a level discount.
- The Gap figure now shows the real room left for a hand discount, after level discount, loyalty and coupon — and the bill shows the total Gap.

## Products and variants

- A product can now have variants (for example the same item in Black and Blue). Use **Add variant** on a product; each variant keeps its own photos, price and stock.
- New **Variants** tab with an editable table; each variant has an **Open** link.
- Attributes (like Length or Colour) can be set for several product groups at once; a parent group covers its subgroups.
- The online name now follows the same name template as the offline name, and one Attributes token prints all of a product's attributes.

## Online shop

- Shop product pages show variant buttons, so customers can switch between options.
- Product photos open full-screen with zoom and pinch.
- Product page shows a scannable barcode and a Close button.
- Changes to a variant's label show on the shop at once.

## Preparing products for the shop

- New **Attention** stage: a product with a problem can be flagged and parked in its own tab, then resolved by saving it as draft or ready. Claude and the in-app AI park a clash here too.
- Draft is again one copy per product, and the Products list shows the open draft.
- AI-suggested photos open large before you tick them; Remove suggestions show consistently.

## Boards and workflow

- Help, Deals and Tasks boards keep only the last 30 days of closed tickets and show 20 per column, with **Show more** — faster to open.
- A status row can be expanded to see all its settings, and its resolve time can be set to **No time limit**.
