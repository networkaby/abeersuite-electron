# v1.16.27

Every counter should install this one. It adds new fields to products for the online shop, so the counter must update **before** the office site is updated — until it does, its sync pauses.

## Online shop — product stages

- Every product now shows where it stands for the online shop: **Unpublished**, **Ready** or **Published** (Published with a rule not yet met shows as **Pending**).
- **Ready** means the work on a product is complete and checked, but it is waiting for a good time to go live.
- Edits to a product's shop page now wait in a separate **draft copy** — the shop keeps showing the last finished version until staff press **Save as ready**.
- **Unpublish** now moves a product back to Ready, so its finished work is not lost.
- Every product that is live in the shop today stays live.

## Online shop — product pages

- **Works with**: printers now list their inks, razors their blades, and so on, taken from each product's Compatible Models — and customers can search by them.
- Products list: right-click on Edit, Edit product, Preview or the product name to open it in a new window.

## Product copy by Claude

- Claude can now prepare product copy (name, description, highlights, specs, warranty, brand, collections, shipping weight and parcel size) as a **draft for staff** — it never publishes and never overwrites what staff have written.
- Claude leaves notes on anything in our data that looks wrong.
- Product copy has its own key in Incoming API, apart from reviews and posts.
- Better maker photos: up to 8 photos are found on a maker's page instead of 1, and sites that block reading are handled.
- Fact check is stricter: a number counts only with its proper unit, and short brands like HP and LG are recognised.

## Price Watch

- New read-only **Price Watch**: compares our prices with Amazon.in and Flipkart (and the maker's MRP) and reports which ones need attention. It never changes a price.
