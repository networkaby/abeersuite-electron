---
name: price-watch
description: Compare AbeerSuite shop prices with Amazon.in and Flipkart (and the maker's MRP) for chosen products and report which prices need attention — read only, never changes a price. Use when the owner says "price watch", "check our prices", "are we too costly", "compare prices with Amazon / Flipkart", "which prices need attention", or runs /price-watch (by hand or on a schedule).
---

# Price watch (read only)

You read our shop price, MRP and stock from AbeerSuite, find the **same product**
on **Amazon.in and Flipkart** — the only market prices that count (owner,
2026-11-08) — and write a report of the prices that need attention. **You never change a price** — staff decide in Pricing Strategy.
The report is your own output; nothing is saved in the app.

## Setup (ask once if missing)

- `ABEERSUITE_URL` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `PRICE_WATCH_API_KEY` — the **Claude — Price watch** key from Settings → Incoming API (its own key).

Never print the key or write it into a file. `401` → wrong key or the card is off — stop and tell the owner.

## 1. What to check (from the owner's words; defaults in bold)

| Owner says | Filter / setting |
|---|---|
| nothing particular | **published + in stock**, newest first, `limit=25` |
| "SKU 107102" / "these: 107102, 107233" | `sku=107102,107233` (any stage, any stock) |
| "Portronics" / "the HP heads" | `brand=portronics` / `q=hp head` |
| "monitors" / "USB HUB group" | `group=monitor` |
| "everything" / "out of stock too" | `stage=all` / `inStock=0` |
| "50 of them" | `limit=50` (max), next page `before=<nextBefore>` |
| "with cost" / "check margin" | `withCost=1` — **off unless the owner asks** |
| "flag above 5%" / "below 30%" | your limits — **higher by 10%**, **lower by 20%** |

```bash
curl -sS -H "x-api-key: $PRICE_WATCH_API_KEY" "$ABEERSUITE_URL/api/agent/prices?<filters>"
```

Answer: `{ checkedAt, products: [{ id, sku, name, brand, group, modelNo, barcodes, ourPrice, mrp, stock, shopStatus, live, shopUrl, lastCost? }], notFound?, nextBefore }`. Prices in ₹, GST included. `lastCost` is the purchase-bill rate (may be before GST — treat margin as rough).

Tell the owner how many products you will check before starting a long run.

## 2. Find the same product elsewhere

For each product search, India first: brand + exact model / part code (`modelNo`, or the code in the name), or the barcode.

- **Amazon.in** and **Flipkart** only for the price. Other shops and the maker's store never count as the market price — if neither marketplace has it, the product is ⚪ Not found.
- The **maker's own India store** (hp.com/in-en, portronics.com, …) only to check the **MRP** — not for the gap.
- **Same product only**: same model / part code, same capacity / size / colour / pack size. A sister model, a different pack (2-pack vs 1), refurbished or used → not the same; skip it.
- Note for each: **price** (what a buyer pays now, delivered price if shown), **seller** (Amazon itself / a seller name), **in stock or not**, **link**, and the date.
- A marketplace page shows many prices (other products in "similar" rows): use only the price of **this** listing — the one under its title, or the page's own product data. Unclear → "could not check", never guess.
- Blocked or unclear page → say "could not check", never guess.

## 3. Compare and flag

Use the **lowest in-stock same-product price on Amazon.in or Flipkart** (`market`).

| Flag | When |
|---|---|
| 🔴 **We are higher** | `ourPrice` is more than the higher limit (10%) above `market` — losing sales |
| 🟠 **We are much lower** | `ourPrice` is more than the lower limit (20%) below `market` — leaving money on the table |
| 🟠 **Above MRP** / **MRP differs** | `ourPrice` > `mrp`, or Amazon / Flipkart / the maker show a different MRP than ours |
| 🔴 **Below cost** / 🟠 **Thin margin** | only with `withCost`: `ourPrice` < `lastCost`, or margin under 10% |
| ✅ **OK** | within the limits |
| ⚪ **Not found** | no same-product price on Amazon.in or Flipkart |

Never suggest a price below cost; never call a sister model a match.

## 4. Report

Start with a one-line summary: *checked N · needs attention N · OK N · not found N*.

Then a table, **needs attention first** (biggest gap first):

| Product (SKU) | Ours | MRP | Market lowest (where) | Gap | Flag | Links |
|---|---|---|---|---|---|---|
| HP X4E75AA Black Printhead (123299) | ₹1,490 | ₹1,499 | ₹1,350 (Amazon, seller X) | +10.4% | 🔴 We are higher | [Amazon](…) · [Flipkart](…) |

Then the OK and not-found ones in a short list. End with:

> Prices are not changed. To act, open **Pricing Strategy → Update & Print Labels** for the flagged items.

On a schedule, the report is the run's output — keep it the same shape every time so runs can be compared.
