# v1.17.0

This version marks the new online-shop and product-copy features that arrived in v1.16.27, and adds a small WhatsApp fix. Counters already on v1.16.27 can install it when convenient — there is no rush.

## New in 1.17 (arrived with v1.16.27)

### Online shop — product stages

- Every product shows where it stands for the online shop: **Unpublished**, **Ready** or **Published** (Published with a rule not yet met shows as **Pending**).
- **Ready** means the work on a product is complete and checked, but it is waiting for a good time to go live.
- Edits to a product's shop page wait in a separate **draft copy** — the shop keeps showing the last finished version until staff press **Save as ready**.
- **Unpublish** moves a product back to Ready, so its finished work is not lost.

### Online shop — product pages

- **Works with**: printers list their inks, razors their blades, and so on, taken from each product's Compatible Models — and customers can search by them.
- Products list: right-click on Edit, Edit product, Preview or the product name to open it in a new window.

### Product copy by Claude

- Claude prepares product copy (name, description, highlights, specs, warranty, brand, collections, shipping weight and parcel size) as a **draft for staff** — it never publishes and never overwrites what staff have written.
- Claude leaves notes on anything in our data that looks wrong.
- Product copy has its own key in Incoming API, apart from reviews and posts.
- Up to 8 maker photos are found on a maker's page instead of 1, and a stricter fact check.

### Price Watch

- Read-only **Price Watch** compares our prices with Amazon.in and Flipkart (and the maker's MRP) and reports which ones need attention. It never changes a price.

## Fixed in this version

- A WhatsApp chat card you drag to a new place now stays fully on screen, even when the chat is tall.
