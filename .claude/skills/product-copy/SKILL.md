---
name: product-copy
description: Write Verified online-shop copy (title, highlights, description, specs, warranty, photo advice) for AbeerSuite products as Claude, through the Cowork agent API — photo check, maker/seller page search, write from proven facts only, server fact check, saved as a Draft for staff. Use when the owner says "write product descriptions", "do product copy", "verified copy for the shop", "fill the unpublished products", or runs /product-copy.
---

# Product copy (Verified, by Claude)

You do the Verified steps yourself — look at the photos, search the web, read
the pages, write — and send the result to AbeerSuite. The server then reads
your pages **itself** and drops any fact it cannot find on them (Step 4). The
copy goes into the product's **draft copy**; the shop keeps showing the last
finished version. Staff review it on the product page, press **Save as ready**,
and publish when the time is right. You never publish.

The rule above all: **no information is better than false information.**

Full design: `docs/ai-product-copy-pipeline.md`.

## Setup (ask once if missing)

- `ABEERSUITE_URL` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `PRODUCT_COPY_API_KEY` — the **Claude — Product copy** key from Settings → Incoming API (its own key, not the reviews / posts one).

Never print the key or write it into a file.

## 0. Pick products

Turn what the owner says into the filters below and read the list:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/products?<filters>"
```

| Owner says | Filters |
|---|---|
| nothing particular ("do product copy") | *(none)* = newest Unpublished, no description, no draft open |
| "SKU 107102" / "these: 107102, 107233" | `sku=107102,107233` — exactly these, in that order |
| "the Portronics hub" / a barcode | `q=portronics hub` — name, SKU or barcode |
| "with at least 5 photos" | `minPhotos=5` |
| "only what is in stock" | `inStock=1` |
| "Portronics brand" / "USB HUB group" | `brand=portronics` / `group=usb hub` |
| "ready ones" / "published ones" / "open drafts" | `stage=ready` / `published` / `draft` (`all` = any) |
| "even if it has a description" | `need=all` |
| "10 of them" | `limit=10` (max 50) |

Filters combine: "5 Portronics products in stock with 5+ photos" → `brand=portronics&inStock=1&minPhotos=5&limit=5`.

Answer: `{ products: [{ id, sku, name, brand, group, shopStatus, hasDescription, photos, stock, draftWaitingSince }], notFound?, nextBefore }`.

- With `sku` or `q`, stage and description are not filtered unless you send them — a Published product can be redone; the work goes into its draft and the live product is untouched until staff Save as ready.
- `notFound` → those SKUs are wrong, inactive or filtered out; tell the owner.
- A `q` search that matches several products: show the list and ask which before starting.
- Next page: add `&before=<nextBefore>`.
- `401` → wrong key or "Claude — Product copy" is off on Settings → Incoming API. Stop and tell the owner.
- Skip products with `photos: 0` unless the owner says otherwise — with no photo there is no label to trust.
- `draftWaitingSince` set → a draft is already open; say so and ask before adding to it.
- Tell the owner which products you will do before you start. Do them **one at a time**, steps 1–6 each.

## 1. Check (look at the photos)

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/products/<id>"
```

Answer: `{ name, brand, category, modelNo, barcodes, typedSpecs, shopSupportDays, currentDescription, photos: [url…], writing: [rules…], photoKinds, photoRemoveReasons, currentCollections, masters: { brands: [{ id, name }], collections: [{ id, path }] } }`.

Open **every** photo URL and look at it. Never use your own memory of this product.

1. **Clashes** — a real disagreement between our typed data (name, modelNo, barcodes, typedSpecs) and the photo: a different brand or model, a different printed number (capacity, wattage, length, count printed on the box), or a photo of a different product.
   - Not a clash: missing data, the same thing spelled differently ("2 Yrs" = "2 Years"), a count you can only *see* (not printed).
   - Warranty: our `shopSupportDays` being **shorter** than the printed warranty is normal. Only **longer** is a clash.
   - **Any clash → stop this product.** Do not send anything. Tell the owner: `field: typed "X", photo shows "Y"`. Go to the next product.
2. **labelFacts** — facts PRINTED on the product / box / label, copied as printed (`{"Capacity": "10000 mAh"}`).
3. **seen** — things only visible in the photo, counts worded "at least N" (`{"USB-A ports": "at least 2"}`).
4. **identity** — which facts tell this product from its sister models (capacity, size, wattage, yield, socket count).
5. **Codes and website** — model / part codes and barcodes printed on the label; a website printed on the box (`labelWebsite`).

## 2. Pages (search the web)

Search for brand + exact model / part code (or brand + type + main printed spec when there is no code). India first.

- **Maker's site first** (a host with the brand's name, or the website on the box), its Indian page when there is one. Then big Indian sellers (Amazon.in, Flipkart, …). Nothing else — blogs, price sites and other shops are dropped by the server anyway.
- At most **8 pages**.
- A page showing **our barcode** is the same product: accept it.
- A page showing a **different barcode** is a different version: reject it.
- Any other page: accept only if nothing on it disagrees with a label fact or identity fact. One real disagreement rejects the whole page (it may be a sister model). A page that simply does not mention a fact is not a disagreement. "At least" counts are minimums.
- Never use a fact from a rejected page. English text only.

Keep every page you read, accepted or rejected, with a short `why`.

## 3. Write

Follow the `writing` lines from step 1 exactly — they are the shop's house style and the exact keys (`title`, `summary`, `highlights`, `description`, `compatibility`, `howToUse`, `warranty`, `specs`, `unsure`). Write from the label facts and accepted pages **only**.

Also add:
- `specSources` — for every key in `specs`: `"label"` or the **url** of the accepted page it came from.
- `dataFlags` — where our typed data disagrees with the label or an accepted page, in simple words (e.g. "Page with your barcode says 8 sockets; your name says 4"). Empty or shorter typed data is not a flag; a shorter shop support period is not a flag.

Warranty: only the **maker's** warranty, from the label or an accepted page. Our `shopSupportDays` is never written.

## 4. Send (the server checks)

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/products/<id>/copy" -d '{
    "labelFacts": { "Model": "POR-2149", "Ports": "8-in-1" },
    "seen": { "USB-A ports": "at least 2" },
    "labelWebsite": "www.portronics.com",
    "pages": [
      { "url": "https://www.portronics.com/products/mport-8", "accepted": true, "why": "maker, our EAN on page" },
      { "url": "https://www.amazon.in/dp/XXXX", "accepted": false, "why": "shows 7-in-1 — sister model" }
    ],
    "copy": {
      "title": "…", "summary": "…", "highlights": ["…"], "description": "…",
      "compatibility": [], "howToUse": [], "warranty": "…",
      "specs": { "Model Number": "POR-2149" },
      "specSources": { "Model Number": "label" },
      "unsure": [], "dataFlags": []
    },
    "brandId": 12,
    "collectionIds": [34],
    "notes": ["Spelling in the name: \"HUB-C\" → \"USB-C\""],
    "photos": { "have": ["front"], "must": ["ports"], "nice": ["in_use"], "remove": [] }
  }'
```

- The server downloads your pages again, checks every spec, highlight number and warranty against them, and moves anything unproven to `unsure`.
- Answer: `{ result: "draft", shopStatus, kept: { specs, highlights, warranty }, unsure, flags, note, sources }`.
- `422` with a message → fix the JSON as the message says and send again.
- Tell the owner per product: what was kept, what went to `unsure` and why (the `note` names pages not used).

## 5. Brand, collections and notes (in the same POST)

- **`brandId`** — the product's brand from `masters.brands`, only when `brand` is empty. Already set and different from the photo? That is a clash (step 1) — stop.
- **`collectionIds`** — from `masters.collections`, the ones this product belongs in (by `path`). They are **added**; the ones in `currentCollections` stay and the main one is not changed. Pick only what clearly fits; none is fine.
- **Never invent an id.** Use only ids from `masters`.
- **`notes`** — every problem staff should fix, in simple words, one per line. For example:
  - `Brand "Portronics" is not in masters — create it, then set it`
  - `Create a collection "USB-C Hubs" under "Computer › Accessories"`
  - `Spelling in the name: "8-in1 HUB-C Hub" → "8-in-1 USB-C Hub"`
  - `Group "USB HUB" looks wrong for a docking station — check (GST)`
  - `Model number POR-2149 is not in the Model No field`
- The group (category, which sets GST) is never changed by you — only a note.

All of this goes into the draft; staff see the brand and collections on the product page and accept them with Save as ready (it needs the product-masters permission).

## 6. Photo advice (in the same POST, optional)

`photos` uses the keys in `photoKinds`:
- `have` — kinds our gallery already shows.
- `must` — kinds missing that a buyer needs to judge THIS product, most important first (usually front, then size).
- `nice` — kinds missing that add feel, most useful first.
- `remove` — our photos that should go: `{ url, why: one of photoRemoveReasons, note }` (duplicate: list only the weaker; a box shot and a product shot are never duplicates).

Never list a kind that makes no sense for the product. Leave `photos` out if you did not look properly.

## After

Report a short table: product · result (draft / stopped on clash) · specs kept · unsure count · flags · notes (brand / collections set or to create). Remind the owner the drafts wait on **E-Commerce → Products → Draft**: open the product, use what is right from the AI copy, **Save as ready**, and Publish when the time is right.
