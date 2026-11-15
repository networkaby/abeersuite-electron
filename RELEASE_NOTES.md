# v1.17.6

Every counter should take this update. It carries a database change for product prices and fixes the "Copy incomplete" badge some counters were showing. **Update the counters first.** The office site gets the database change afterwards, and a counter's sync pauses until it is updated.

## Pricing
- **Fixed Price until next purchase.** A new clock button in the Fixed Price box makes a price temporary. When the next purchase or GRN is posted, the product goes back to its earlier selling price and Fixed Price on its own.
- The price box shows what a temporary Fixed Price will go back to.

## Deals and customers
- The deal screen now shows the customer's history, past messages, and a lead quality column.
- You can send WhatsApp from the deal screen: a normal text inside the 24-hour window, an approved template after that. Every message sent is saved on the deal's timeline. The WhatsApp link opens this screen instead of wa.me.
- On purchase lines, the price shown is what the customer actually paid (after discount, with GST). Matching similar items now allows small spelling mistakes, like "pendrive" and "pen drive".
- Credit limit and the POS customer summary now count online orders as well.

## WhatsApp tickets
- Customers pick from a ticket menu with tap buttons or a list, so they no longer have to type a number. Plain "yes" / "haan" and "no" replies are understood.

## E-Commerce
- New **Can deep edit** tick on the Role page. E-Commerce staff can edit a product's main details without full product rights. Tax, opening stock, SKU and sale price stay locked.

## Reports
- Every BI report now counts additional costs (freight etc.) in item cost.

## Security and sign-in
- Wrong password, OTP and PIN attempts are now counted on the server, so the limit holds everywhere.
- Outside services that connect without a key are now refused, and Razorpay payment messages are checked for a valid signature.
- Settings → Incoming API shows each caller's key with a copy button.

## Sync
- Fixed the red "Copy incomplete" badge that stayed on some counters with nothing left to retry.
