---
name: product-copy
description: Prepare AbeerSuite shop products as Claude through the agent API — check photos against our data, find the maker / seller pages, write Verified copy (name, description, highlights, specs, compatibility, warranty), set brand and collections, fill shipping weight and parcel size, pick photos from the maker's page, advise on the gallery, and note every mistake in our data — all written onto the product, which moves to Draft for staff (never published, never "ready"). Also reviews finished products and leaves notes only. Use when the owner says "do product copy", "write product descriptions", "prepare products for the shop", "review the drafts", "check product 722", or runs /product-copy.
---

# Product copy (Verified, by Claude)

You prepare products for the online shop and send everything to AbeerSuite.
The server reads your pages **itself** and drops any fact it cannot find on them.
Everything is written **straight onto the product** (there is one copy, no
separate draft) and the product moves to the **Draft** stage — off the shop until
staff finish it. Your text replaces what was there.

**You only ever leave products in Draft.** You never press Save as ready, never publish,
never create brands / collections, never change the group (GST). Staff review the
product, fix what your notes say, press **Save as ready**, and publish when the time
is right. Because a Published product leaves the shop while in Draft, say so in your
report when you touched one.

The rule above all: **no information is better than false information.**

**Run every step, every time.** Our own AI runs these steps as code and cannot
skip one; you must not either. Never skip a step because you *guess* it will find
nothing — do it, and report what it found. A step that truly cannot run (no photo,
every page refused) is reported with the reason, never silently left out.

Full design: `docs/ai-product-copy-pipeline.md`.

## Setup (ask once if missing)

- `https://office.networkservice.in` — the office site, e.g. `https://office.example.com` (no trailing `/`).
- `balkelaharami@420` — the **Claude — Product copy** key from Settings → Incoming API.

The commands below read them as `$ABEERSUITE_URL` (the site) and
`$PRODUCT_COPY_API_KEY` (the key) — set both before the first call.

Never print the key or write it into a file. `401` on any call → wrong key, or the
card is switched off — stop and tell the owner.

## Two modes

| Owner says | Mode |
|---|---|
| "do product copy", "prepare 5 products", "SKU 107102" | **Prepare** — steps 0–9 |
| "review product 722", "review the drafts / ready ones", "check for mistakes" | **Review** — notes only, step R |
| "do compatibility for all ink, toner and printheads", "blades for razors" | **Compatibility** — the compatible list only, step C |

---

## 0. Pick products

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/products?<filters>"
```

| Owner says | Filters |
|---|---|
| nothing particular | *(none)* = newest Unpublished, no description |
| "SKU 107102" / "these: 107102, 107233" | `sku=107102,107233` — exactly these, in that order |
| "the Portronics hub" / a barcode | `q=portronics hub` |
| "with at least 5 photos" | `minPhotos=5` |
| "only what is in stock" | `inStock=1` |
| "Portronics brand" / "USB HUB group" | `brand=portronics` / `group=usb hub` |
| "ready ones" / "published ones" / "drafts" | `stage=ready` / `published` / `draft` (`all` = any) |
| "even if it has a description" | `need=all` |
| "10 of them" | `limit=10` (max 50) |

Filters combine: `brand=portronics&inStock=1&minPhotos=5&limit=5`.

Answer: `{ products: [{ id, sku, name, brand, group, shopStatus, hasDescription, photos, stock, draftWaitingSince }], notFound?, nextBefore }`.

- With `sku` or `q`, stage and description are not filtered — a Published product can be redone; it moves to Draft (off the shop) when you save.
- `notFound` → tell the owner. Several `q` matches → show the list and ask.
- Skip `photos: 0` unless told otherwise. `shopStatus: "DRAFT"` → someone is working on it; say so and ask before writing over it. What you read is exactly what staff and the shop data hold.
- **Tell the owner the list before starting.** Then do them **one at a time**, steps 1–9 each.
- Each product is saved the moment its step 9 (or its stop notes) goes through — keep a running done / stopped list in the chat. A run that broke off is resumed by listing again: finished ones now show `shopStatus: "DRAFT"` (done) or Attention (stopped); start from the first one still untouched.

## 1. Read the product

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/products/<id>"
```

Answer: `{ name, brand, category, modelNo, barcodes, typedSpecs, shopSupportDays, currentDescription, photos, writing, photoKinds, photoRemoveReasons, photoLookOptions, photoProxy, currentCollections, masters: { brands, collections } }`.

**Photos will not open** (the photo host is blocked in your workspace)? Get each one through our server — same key, `n` = its place in `photos` (1, 2, 3…):

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/products/<id>/photos/<n>" -o photo<n>.jpg
```

Never stop a product because a photo URL is blocked — use this.

## 2. Check the photos (open every one)

Never use your own memory of the product.

1. **Clash** = our typed data (name, modelNo, barcodes, typedSpecs) disagrees with what is **printed**: another brand or model, another printed number (capacity, wattage, size, count). Not a clash: missing data, the same thing spelled differently, a count only *seen*, our support period shorter than the printed warranty.
   **Unbranded is not a clash.** When `brand` is **Premium Unbranded** or **Unbranded** (the office's quality levels for no-name goods — older products may still say Special / Generic), a little-known name printed on the item (e.g. CLATE) is normal, and the brand word in our office name is not a typed brand. Do not stop: put the printed name in the online name (`title`) and a `Brand` spec row (source `"label"`), leave `brandId` alone, and do not ask for a new brand — these are one-off names, never master brands. Only other printed facts (model, capacity, size, count) can still clash.
   **Any clash → stop this product: no copy, nothing saved.** Report `field: typed "X", photo shows "Y"` (e.g. `capacity: typed "128GB", label shows "256G"`).
   Then **save what you found as notes** so staff see it in AbeerSuite, not only in this chat — the notes route (step R) changes no field and parks the product in the **Attention** stage (off the shop):
   ```bash
   curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"      "$ABEERSUITE_URL/api/agent/products/<id>/notes" -d '{ "notes": ["STOPPED — capacity: typed \"128GB\", photo 3 sticker shows \"256G\". Check the real unit, then ask Claude to run product copy again.", "Model No is empty — sticker prints HS-SSD-E1000."] }'
   ```
   The clash first. Then, before sending, go once through the **mistake check list (step 8)** using only what you already have (product data + photos — no searching), and add each problem it finds, one per line. Staff then fix everything in one visit.
   **Brand missing from the list is also a stop, decided here** — before any search or writing: a **well-known** brand printed on the item but absent from `masters.brands` → same notes route, line "Brand X is printed but not in the Brand list — create it, then ask Claude to run product copy again".
2. **labelFacts** — printed on product / box / label, copied as printed.
3. **seen** — only visible, counts as "at least N".
4. **identity** — what tells it from sister models (capacity, size, wattage, yield…).
5. Codes, barcodes and any website printed on the box (`labelWebsite`).
6. While looking, note **photo problems** for step 8.

## 3. Find the pages

**Always search, even with no brand or model on the box.** Then search with what *is* printed: the spec lines, the port count, a code, the box wording ("HDMI splitter 1x2 4K x 2K 1.4B"). Unbranded goods are often sold online in the very same box.

Search brand + exact model / part code (India first). **Maker's site first**, then big Indian sellers (Amazon.in, Flipkart, Reliance Digital, Croma). At most 8 pages. Blogs and other shops are refused by the server.

**A page blocks you** (too many requests, bot check, empty)? Ask the server:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/read-page" -d '{ "productId": <id>, "url": "<page>", "labelWebsite": "" }'
```

Answer: `{ read: true, site, maker, codeMatch, text, photos }` or `{ read: false, why }`.

- **Our code / barcode on the page** (`codeMatch`) → same product: accept.
- **A different barcode** → another version: reject.
- Other pages: accept only if nothing disagrees with a label or identity fact. One real disagreement rejects the whole page (sister model). Not mentioning a fact is not a disagreement.
- Never use a fact from a rejected page. English only. Keep every page with a short `why`.

## 4. Write

Follow the `writing` lines exactly (house style and keys: `title`, `summary`, `highlights`, `description`, `compatibility`, `howToUse`, `warranty`, `specs`, `unsure`). Label facts and accepted pages **only**.

- `specSources` — for every spec: `"label"` or the accepted page's **url**.
- `dataFlags` — our typed data disagrees with the label or an accepted page.
- **Compatibility** (ink, toner, printheads, RAM, chargers, cables): copy the exact models from the maker's list.
- **Warranty**: only the maker's, from the label or an accepted page — never our support period. Not found → `""` and "Manufacturer warranty" in `unsure`.

## 5. Brand and collections

- `brandId` from `masters.brands` **only** — same rule as the in-app AI:
  - `brand` is a real brand already → leave it (a printed mismatch is a clash, step 2).
  - `brand` empty or Unbranded / Premium Unbranded → the printed brand **if it is in the list**.
  - A **well-known** brand printed but **missing from the list** → already stopped in step 2; you never reach here with one.
  - Little-known or no name, `brand` empty → the **Unbranded** id, plus a note "Change to Premium Unbranded if this is the good-quality line".
- `collectionIds` from `masters.collections` — **added** to `currentCollections`; nothing is removed, the first one (★ main) stays.

### How collections work here

**Group = inventory segmentation**: what the item *is*. It drives GST/HSN and the shop category, and it is never yours to change. **Collection = customer segmentation**: *who buys it*, or *what they are setting up*. A product shows in the shop under its group anyway; collections are the extra shelves shoppers browse by need. Never pick a collection only because it repeats the product type.

A product may sit in **several** collections (usually 1–3). **Every shop product needs at least one.** There is no fallback / "Other" collection.

The table below only explains **which customer each collection is for**. The live list is `masters.collections` — it wins: staff add, rename and remove collections in the office. Use its ids and names; a collection in the live list but not in this table → judge it by its name; one in this table but not in the live list → it no longer exists, never pick it.

| Collection | Customer / setup | Typical items |
|---|---|---|
| Shop by Need › Office & Business | offices, businesses | printers, ink, toner, paper, lamination, PVC cards, monitors, desktops, UPS, mouse / keyboard, hubs, cables, phones, intercom |
| Shop by Need › Home & Family | home users | mouse / keyboard, laptops, home Wi-Fi / 4G cameras, routers, Wi-Fi / BT adapters, speakers, headphones, door locks, inverters |
| Shop by Need › Shop & Retail | shop owners | printers, billing / POS gear, business software, antivirus, desktops, fingerprint scanners |
| Shop by Need › Industrial Security | factories, sites | bullet and IP bullet cameras |
| Shop by Need › PC Upgrade & Repair | technicians, DIY upgraders | RAM, SSD / NVMe, HDD, PC SMPS, cooling, thermal paste, CMOS and laptop batteries, laptop adapters and parts, printer heads, HDD casings, sound cards |
| Shop by Need › Mobile & Travel | phone users, travellers | earphones, Airdopes, chargers, car chargers, power banks, data cables, OTG, card readers, memory cards, pen drives, holders / tripods, laptop bags |
| Shop by Need › TV & Home Entertainment | TV and speaker setups | HDMI, AV and audio cables, TV remotes, wall mounts, speakers |
| Shop by Need › Electrical & Fittings | wiring, fitting, mounting | extension boards, spike guards, switches / sockets, wire, junction boxes, wall plugs, tools, inverter parts |
| Shop by Need › Gaming | gamers | anything gaming / RGB / esports, graphics cards |
| Setup Kits › New PC Build | building a PC | cabinet, motherboard, RAM, SSD, PC SMPS, cooling, graphics card |
| Setup Kits › CCTV & Security Setup | CCTV install | cameras, DVR / NVR, HDD, CCTV power supply, BNC / DC connectors, video cable, racks, junction boxes, memory cards |
| Setup Kits › Office Network Setup | office LAN / Wi-Fi | switches, routers, network cable, keystone jacks / face plates, LAN cards, racks, cable accessories |
| Setup Kits › Billing Counter Setup | billing counter | barcode scanners, cash drawers, labels, POS accessories, UPS |
| Offers › … | set by staff | **never pick** (Best Sellers, Clearance, New Arrivals) |

How to pick:
1. Who would buy this? Add each **Shop by Need** segment that clearly fits.
2. Is it part of a setup? Add that **Setup Kit** too. A CCTV power supply goes to CCTV & Security Setup; a PC SMPS goes to New PC Build and PC Upgrade & Repair.
3. Add **Gaming** only when the item says gaming / RGB / esports, or is a graphics card.
4. The group looks wrong for the item (a webcam filed as CCTV, an Anchor switch filed as Network Switch, a phone filed as RAM) → pick collections by **what it really is**, and add a note: "Group looks wrong — should be X (GST!)".
- **Nothing fits → a note is required**: "No collection fits — suggest creating 'Shop by Need › …'". Never leave it silent.
- **Never invent an id.** Missing brand / collection → a note — except a one-off printed name on an Unbranded / Premium Unbranded product (step 2): that goes in the title and a spec row, never a note.
- Never put "Premium Unbranded", "Unbranded", "Special" or "Generic" in the title, description or highlights.

## 6. Shipping weight and parcel size

For the courier rate. Prefer the **package** weight and size (what is shipped); else the product's own. Quote them **exactly as the source prints them**:

```json
"shipping": { "weight": "~0.05 kg", "dimensions": "116.26 x 36.46 x 100.94 mm", "source": "<accepted page url or \"label\">" }
```

The server finds the text on that source, converts it itself (grams; whole cm, rounded up), and sets the product's weight / size. Not on any source → leave `shipping` out and add a note ("Shipping weight / size unknown — weigh the box").

## 7. Photos from the maker / seller pages

Run this when the product has **fewer than 4 good photos** (after leaving out the ones you will mark for removal) **or** any `must` kind is missing. Pick from the **accepted** pages' `photos` and send `photoPicks`, best first, each with the kind it fills:

```json
"photoPicks": [ { "url": "https://www.portronics.com/cdn/shop/files/M8_-_1.png", "kind": "front" } ]
```

Only this exact model and colour; no watermark, no other brand's logo, sharp. Prefer the maker's. Fill the `must` kinds first. The server keeps a pick only if an accepted page shows it; staff add them — nothing goes into the gallery by itself.

## 8. Mistake check → `notes`

Go through this list for every product and write each problem as one short line in `notes`:

- **Name**: spelling ("8-in1 HUB-C" → "8-in-1 USB-C"), wrong order, missing model code, a better shop name.
- **Model No / barcode** empty while the box prints them — give the exact value to copy in (the in-app AI fills them itself). A printed barcode that is already on another product → say which SKU (same product twice?).
- **Brand / collections**: missing from masters (say what to create), or the set one looks wrong.
- **Collections**: none set, a customer segment or Setup Kit missed (e.g. CCTV parts not in "CCTV & Security Setup"), or one picked only because it repeats the product type.
- **Group** looks wrong for the product (GST!) — say which fits; never change it yourself.
- **Primary photo** with any logo, watermark, date stamp or text overlay (our own shop logo too) → "Pick a clean primary photo — Google and Meta reject logos on the main image". Our logo or a camera stamp on the other photos is fine.
- **Photos**: another model or old box version, someone else's watermark, blurry / dark, duplicates, no plain product front, no size photo, the main photo is not the best.
- **Description already there**: a wrong spec, missing compatibility, our support period written as the maker's warranty.
- **Shipping**: weight or size missing and not found anywhere.
- **Price / stock**: only if something is plainly off (MRP below price) — say it, never guess a price.

## 9. Send (the server checks)

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/products/<id>/copy" -d @copy.json
```

`copy.json`:

```json
{
  "labelFacts": { "Part code": "X4E75AA" },
  "seen": {},
  "labelWebsite": "",
  "pages": [ { "url": "https://www.hp.com/in-en/shop/...", "accepted": true, "why": "maker, part code on page" } ],
  "copy": {
    "title": "…", "summary": "…", "highlights": ["…"], "description": "…",
    "compatibility": [ { "type": "Printer", "models": ["HP Smart Tank 500"] } ],
    "howToUse": [], "warranty": "",
    "specs": { "Model Number": "X4E75AA" },
    "specSources": { "Model Number": "label" },
    "unsure": ["Manufacturer warranty"], "dataFlags": []
  },
  "brandId": 12,
  "collectionIds": [34],
  "shipping": { "weight": "~0.05 kg", "dimensions": "116.26 x 36.46 x 100.94 mm", "source": "https://www.hp.com/in-en/shop/..." },
  "photoPicks": [],
  "notes": ["Product name could read better: \"HP Head X4E75AA Black\" → \"HP X4E75AA Black Printhead\""],
  "photos": { "have": ["box_front"], "must": ["front", "size"], "nice": ["in_use"], "remove": [] }
}
```

- `photos.order` = our photo **urls** in the best order, removed ones left out: a clear product front first (it is the shop card and search photo), then the other sides and close-ups, then the box, then feel photos. Leave empty if the order is already right.
- `photos.look` = only our photos that would show better in the shop's frames (4:3 card, square page): `{ url, crop, focus, fixes, rotate, background, why }`, every choice from `photoLookOptions` — `crop: pad` (safe, keeps the whole picture) or `fill` (only when the product sits small in empty space); `fixes` e.g. `trim` a wide border, `auto_color` a yellow tint, `auto_brightness` a dark photo, `improve` a dull one; `rotate` a sideways photo; `background: white` for a plain light background. Staff see the result with **Use / Undo** — the same card our own AI fills.
- `photos` = gallery advice with `photoKinds` keys: what we **have**, what we **must** add (most important first), **nice** to add, and our photos to **remove** (`{ url, why: one of photoRemoveReasons, note }`; duplicates: list only the weaker). Each one shows staff a **Remove** button under *Shop readiness → AI suggests removing* — so never tell staff to delete photos by hand; say "press Remove". Give each wrong photo its own entry with a short `note` ("personal family photo", "Citizen calculator").
- `notes` holds up to 40 lines — one problem per line; never squash several into one.
- Full example of `photos`: `{ "have": ["box_front"], "must": ["front", "ports"], "nice": ["in_use"], "remove": [{ "url": "…/9.jpg", "why": "irrelevant", "note": "personal family photo" }], "order": ["…/2.jpg", "…/1.jpg", "…/3.jpg"], "look": [{ "url": "…/1.jpg", "crop": "pad", "fixes": ["trim", "auto_color"], "rotate": 0, "background": "white", "why": "yellow tint, wide border" }] }`
- Answer: `{ result: "draft", shopStatus, kept, unsure, flags, note, sources }`. `422` → fix as the message says and resend.
- It goes straight onto the product: description, online name, specs (your rows replace ours with the same label; other rows stay), brand, collections (added), shipping. The product moves to Draft.

---

## C. Compatibility mode (the compatible list only)

The shop uses each product's **Compatible Models** list for its "Made for this one", "For the same machine" and "Works with these" rows and for search ("Smart Tank 580 head" finds the head). This mode fills or refreshes only that list — nothing else changes.

1. Pick the products: `group=ink`, `group=toner`, `group=printhead`, `q=blade`, `q=charger`… with `need=all&stage=all`.
2. For each, find **its own** maker's page (the accessory's maker, not the machine's): the part code's page on hp.com, canon.in, epson.co.in, gillette.co.in, or a third-party blade / ink maker's page. Use `read-page` when blocked.
3. Copy the models **exactly as the page lists them** ("HP Smart Tank 580", "Gillette Mach3"). Other brands are fine when the accessory's maker says so — a BIC blade that fits Gillette Mach3 lists "Gillette Mach3".
4. Send:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$ABEERSUITE_URL/api/agent/products/<id>/compatibility"   -d '{ "pages": [ { "url": "<maker page>", "accepted": true, "why": "maker, part code on page" } ], "models": ["HP Smart Tank 580", "HP Smart Tank 515"] }'
```

Answer: `{ kept, dropped, sources }`. The server keeps only models really on an accepted page and **replaces** the old list on the product, which moves to Draft (the maker's current list is the truth). Report kept / dropped per product.

- No maker list anywhere → skip, and note it ("no compatible list found").
- A full Prepare run (steps 1–9) also saves the checked `compatibility` as this list.

## R. Review mode (notes only)

For finished products — staff's copy or an earlier one of yours. **Change nothing**; only notes. The notes park the product in the **Attention** stage with the notes as its reason — off the shop, even if it was Published — until staff check it and Save as draft or Save as ready. So send review notes only for real problems.

1. Read the product (step 1) and its photos (step 2) — look for clashes and photo problems.
2. Read the maker's page (step 3, `read-page` if blocked) and compare the current description, specs and compatibility with it.
3. Go through the **mistake check** (step 8).
4. Send the notes:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/products/<id>/notes" -d '{ "notes": ["…", "…"], "replace": false }'
```

Notes are **added** to the Attention reason already there (`replace: false`, the default). Use `replace: true` only when the owner asks for a fresh review — it drops the old ones. Nothing wrong → send nothing and say "no problems found".

**Published products: send only problems worth taking it off the shop** — a wrong spec, wrong compatibility, a clash, our support period shown as the maker's warranty, a wrong group (GST), a logo on the primary photo. Small things (a name that could read better, a nice-to-have photo, a missed extra collection) do **not** go to the server for a Published product — list them in the report under "Minor, not sent" so the owner decides.

---

## Report (always, at the end)

A short table, one row per product:

| Product | Result | Kept | Unsure | Notes |
|---|---|---|---|---|
| SKU · name | draft / stopped: clash / reviewed | specs n · compatible n · photos picked n · shipping ✓ | n | the 1–3 most important |

In Review mode, add **Minor, not sent** — the small points held back for Published products.

Then: **stopped products** with the exact clash (staff must fix the data or the photos), and the next step for the owner:

> **Attention** tab: the stopped products, parked with the clash as the reason — check the real unit, fix the data or photos, then **Save as draft** (and run product copy again) or **Save as ready**.
> **Draft** tab: the finished ones — read "Notes for you", add the suggested photos, fix what the notes say, then **Save as ready**. Publish when the time is right.
