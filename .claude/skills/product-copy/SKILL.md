---
name: product-copy
description: Write Verified online-shop copy (title, highlights, description, specs, warranty, photo advice) for AbeerSuite products as Claude, through the Cowork agent API — photo check, maker/seller page search, write from proven facts only, server fact check, saved as a Draft for staff. Use when the owner says "write product descriptions", "do product copy", "verified copy for the shop", "fill the unpublished products", or runs /product-copy.
---

# Product copy (Verified, by Claude)

You do the Verified steps yourself — look at the photos, search the web, read
the pages, write — and send the result to AbeerSuite. The server then reads
your pages **itself** and drops any fact it cannot find on them (Step 4). The
copy is saved as a **Draft** on the product; staff review it on the product
page and press Publish. You never publish.

The rule above all: **no information is better than false information.**

Full design: `docs/ai-product-copy-pipeline.md`.

## Setup (ask once if missing)

- `ABEERSUITE_URL` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `COWORK_API_KEY` — the **Cowork** key from Settings → Incoming API.

Never print the key or write it into a file.

## 0. Pick products

```bash
curl -sS -H "x-api-key: $COWORK_API_KEY" "$ABEERSUITE_URL/api/agent/products?stage=unpublished&need=copy&limit=10"
```

Answer: `{ products: [{ id, sku, name, brand, group, shopStatus, hasDescription, photos, draftWaitingSince }], nextBefore }`.

- `stage` = `unpublished` (default) · `draft` · `published` · `all`. `need=all` includes products that already have a description.
- Next page: add `&before=<nextBefore>`.
- `401` → wrong key or Cowork is off on Settings → Incoming API. Stop and tell the owner.
- Skip products with `photos: 0` unless the owner says otherwise — with no photo there is no label to trust.
- Tell the owner which products you will do before you start. Do them **one at a time**, steps 1–5 each.

## 1. Check (look at the photos)

```bash
curl -sS -H "x-api-key: $COWORK_API_KEY" "$ABEERSUITE_URL/api/agent/products/<id>"
```

Answer: `{ name, brand, category, modelNo, barcodes, typedSpecs, shopSupportDays, currentDescription, photos: [url…], writing: [rules…], photoKinds, photoRemoveReasons }`.

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
curl -sS -X POST -H "x-api-key: $COWORK_API_KEY" -H "content-type: application/json" \
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
    "photos": { "have": ["front"], "must": ["ports"], "nice": ["in_use"], "remove": [] }
  }'
```

- The server downloads your pages again, checks every spec, highlight number and warranty against them, and moves anything unproven to `unsure`.
- Answer: `{ result: "draft", shopStatus, kept: { specs, highlights, warranty }, unsure, flags, note, sources }`.
- `422` with a message → fix the JSON as the message says and send again.
- Tell the owner per product: what was kept, what went to `unsure` and why (the `note` names pages not used).

## 5. Photo advice (in the same POST, optional)

`photos` uses the keys in `photoKinds`:
- `have` — kinds our gallery already shows.
- `must` — kinds missing that a buyer needs to judge THIS product, most important first (usually front, then size).
- `nice` — kinds missing that add feel, most useful first.
- `remove` — our photos that should go: `{ url, why: one of photoRemoveReasons, note }` (duplicate: list only the weaker; a box shot and a product shot are never duplicates).

Never list a kind that makes no sense for the product. Leave `photos` out if you did not look properly.

## After

Report a short table: product · result (draft / stopped on clash) · specs kept · unsure count · flags. Remind the owner the drafts wait on **E-Commerce → Products → Draft** (a ✨ mark on the row): open, review, Save, then Publish.
