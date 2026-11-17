---
name: product-prep
description: Prepare AbeerSuite shop products as Claude in a loop of parts — Part 1 cleans our own data (removes wrong photos / fields, adds nothing) and checks it is enough to search, Part 2 does the ONE internet search and saves it, Part 3 writes everything from the saved pages (copy, brand, collections, shipping, photos added / removed / ordered) and moves the product to Draft. A major problem stops a part and parks the product in Attention for staff; the next run starts where the last one stopped. Use when the owner says "prep products", "product prep", "run the prep loop", "prepare product 722 step by step", or runs /product-prep. Not product-copy (one-shot) and not product-recheck (Part 4, verify).
---

# Product prep (the loop)

Staff create a product fast during purchase entry — often only the custom part of
the name is right; brand, group, name and collections may be empty or wrong. Another
staff member uploads photos, sometimes onto the wrong product. This skill makes
it shop-ready in parts, and **never writes from bad data**:

| Part | Does | Major problem → | Pass → |
|---|---|---|---|
| **1 Prepare seed** | Read everything; remove what is wrong; add nothing. Then: is what is left enough to search? | Attention | sign `Part 1 done` |
| **2 Search** | The **one** internet search for this product; the pages are saved | — (no good page = go on from the label) | sign `Part 2 done` |
| **3 Process** | Everything from the saved pages — no new search | — (problems are notes) | Draft, sign `Part 3 done` |
| **4 Verify** | separate skill: **product-recheck** | | |

**Major** = it would spoil the next part. **Minor** = a note; the loop goes on.
Staff fix what Attention says and run this skill again — it starts at the next part.

Rules above all:
- **No information is better than false information.**
- **One search per product.** The search API is limited (about 1000 a month). Never search again for a product that has saved pages — Part 3 and Part 4 use them. The server refuses a second search.
- Never publish, never Save as ready, never change the **group** (GST — note it), never create brands / collections.
- This skill and product-copy are separate. Do not mix their endpoints.

## Setup — run mode (where to read, where to write)

The **Claude — Product copy** key (Settings → Incoming API): `balkelaharami@420`.
Never print it in chat or write it into another file.

Every **GET** (reading a product, a list, a photo) goes to `$READ_URL`; every **POST** (saving a part) goes to `$WRITE_URL`. Pick the mode first:

| Mode | When | `$READ_URL` | `$WRITE_URL` | Key from |
|---|---|---|---|---|
| **1 · Cloud** | Running in the cloud (Cowork / claude.ai) — **always this mode there**, it cannot reach this computer | `https://office.networkservice.in` | `https://office.networkservice.in` | the key above |
| **2 · Local** | Owner says "local" — testing on the dev server | `http://localhost:3000` | `http://localhost:3000` | `.env.local`, else `.env` |
| **3 · Smart local** | Owner says "smart local" — reads from the counter app's own copy, writes to the dev server | `http://localhost:786` | `http://localhost:3000` | `.env.local`, else `.env` |
| **4 · Office** | Owner says "office" on this computer — reads from the counter app's own copy (no Supabase egress), writes to the office site | `http://localhost:786` | `https://office.networkservice.in` | `.env.local`, else `.env` |

- **Key from `.env.local`, else `.env`**: the line `PRODUCT_COPY_API_KEY=` — `.env.local` first, then `.env`; neither has it → use the key above. Read it into the variable only, never echo it.
- **Mode not named and running on the owner's computer** → ask once ("cloud, local, smart local or office?"), then keep it for the whole run.
- Before the first product, check both URLs answer (`GET $READ_URL/api/agent/products?limit=1` and the same on `$WRITE_URL`). One not answering → stop and say which (dev server or counter app not running).
- **Mode 3 needs both sides on the same data.** The counter app on `:786` holds a copy of whichever database it syncs with (normally **live**), while the dev server on `:3000` may use the local copy — then reads and writes do not match (a product, its photos and its Part done sign differ). Use mode 3 only when the dev server points at the same database the counter syncs with; otherwise use mode 2.
- Modes 3 and 4 read from the counter app's replica, which can lag the office by a little: if a read looks older than what you just wrote, read that one product again from `$WRITE_URL`.
- `401` → wrong key or the card is off for that server — stop and tell the owner.
- Why: reading from `localhost:786` keeps reads off Supabase egress and Vercel CPU; only the writes go to the server that owns them.

## 0. Pick products and find where each one stands

**Staff choose the work**: they shortlist products with **Start AI** (Products list, row or bulk, or the product page) — including Attention products they have fixed. Those sit in the **Waiting** stage. So with no products named, take the Waiting list first:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$READ_URL/api/agent/products?stage=waiting&need=all&limit=20"
```

Waiting is empty → say so and ask the owner (do not fall back to Unpublished on your own). Products named by the owner (`sku=`, `q=`, ids) are taken whatever their stage. Same filters as product-copy's list (`sku=`, `q=`, `stage=`, `limit=`…). Tell the owner the list first, then one at a time. A Waiting product leaves Waiting by itself: Part 1 stopping → Attention, Part 3 → Draft.

Read each product:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$READ_URL/api/agent/prep/<id>"
```

Answer = product-copy's read (`name, brand, modelNo, barcodes, typedSpecs, photos, writing, masters …`) **plus**
`title` (online name), `group`, `shipping`, `attention` (Attention reason now), `draftNotes`, `processNotes`, and
`prep: { partDone, identityChanged, searchAllowed, searchedAt, pages, dropped, labelFacts, seen, labelWebsite }`.

Start at **part `partDone + 1`**:
- `partDone: 0`, or `identityChanged: true` (staff changed brand / model / barcode — the saved search no longer counts) → **Part 1**.
- `1` → Part 2 (`searchAllowed` true) — or Part 3 if `searchAllowed` is false and a page was kept.
- `2` → Part 3.
- `3` or `4` → done here; tell the owner to run **product-recheck** — **unless the product is in Waiting**.
- **In Waiting (`shopStatus: "WAITING"`) → always start again at Part 1**, whatever `partDone` says: staff sent it back (after fixing Attention, or to redo it). Use the saved search when there is one — send `run` with `part1` + `part3` and **no `part2`** (no new search); only a product with no saved search (`searchAllowed: true`) gets `part2`.
- In Attention: first read `attention` — check staff fixed each STOPPED line (look at the data / photos again). Not fixed → say so, leave it, next product.

Photos blocked? `GET /api/agent/products/<id>/photos/<n>` (n = place in `photos`, from 1).

## How a run goes: one call when nothing stops

Do the thinking of Parts 1, 2 and 3 in order (below), then send it **all in one call** — one read at the start, one write at the end, like product-copy:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$WRITE_URL/api/agent/prep/<id>/run" -d '{ "part1": {…}, "part2": {…}, "part3": {…} }'
```

Each key holds exactly what that part's own call would take (shown in each Part below). The server runs them in order:
- Part 1 finds a **major** problem or `enough: false` → it stops there: `{ result: "attention", stoppedAt: 1 }` — the clean-up and notes are kept, nothing else is written. So **decide Part 1 before you search**: if you already know it will stop, send only Part 1 (`/part1`) and do not spend the search.
- Otherwise it saves the search and writes Part 3 → `{ result: "part3", … }`, product in Draft.
- Part 3 refused (`422`) → the search is still saved; fix and send `/part3` alone.

For Part 3 in one run you work from the pages **you** read (product-copy step 3, `read-page` when blocked) — the server reads the same pages once and checks every fact; `specSources` are those page urls.

Use the single-part endpoints (`/part1`, `/part2`, `/part3`) only to **restart part-way**: after Attention is fixed, or when the product already has a saved search (then leave `part2` out of `run`, or call `/part3`, working from `prep.pages`).

---

## Part 1 — Prepare the seed (remove only, add nothing)

1. **Read everything**: name (the custom part is usually the most reliable), brand, group, collections, SKU, barcodes, model no., specs, title, description, shipping, warranty — and **open every photo**. Never use your own memory of the product.
2. **Find what is wrong**:
   - **Self-contradiction**: fields disagree with each other or with what is *printed* on the item / box (brand, model, capacity, wattage, size, count). Unbranded / Premium Unbranded with a small printed name is **not** a conflict.
   - **Wrong photos**: another product, old box version, someone else's watermark.
   - **Poor photos**: blurry, dark, low resolution, bad angle, duplicates.
   - **Wrong text**: a wrong spec row, our support period written as the maker's warranty, a wrong weight / size, a description of another product.
3. **Decide what is sure**:
   - Sure wrong → `remove` (photos) / `clear` (fields). The server does it now.
   - Not sure → `suggestRemove` (photos, staff get a Remove button) or a note.
   - **Never clear the group** — note "Group looks wrong — should be X (GST!)".
4. **Major or minor?**
   - **Major** (`major`): photos show two different products and you cannot tell which is ours; the custom part and the photos point to different products.
   - Everything else is a minor `notes` line.
5. **Enough to search?** After the clean-up, is there a brand + model, a part code, a barcode, or clear box wording to search with? No → `enough: false` and `need` = what staff must add ("a box / label photo", "the model no. printed on the back").

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$WRITE_URL/api/agent/prep/<id>/part1" -d @part1.json
```

```json
{
  "remove": [ { "url": "…/7.jpg", "why": "irrelevant", "note": "a different hub (4 ports)" } ],
  "suggestRemove": [ { "url": "…/3.jpg", "why": "quality", "note": "blurry, label unreadable" } ],
  "clear": { "brand": false, "title": true, "description": false, "collections": false, "specs": ["Capacity"], "shipping": false },
  "major": [],
  "notes": ["Model No is empty — sticker prints HS-SSD-E1000.", "Group looks wrong — should be SSD (GST!)"],
  "enough": true,
  "need": ""
}
```

`why` is one of `photoRemoveReasons`. Answer: `{ result: "part1" | "attention", removed, notes }`.
- `attention` → stop this product (staff fix, then run again).
- `part1` → go on to Part 2 now.

## Part 2 — The one search

Search **once**, with the cleaned data only: brand + exact model / part code (India first). **Maker's site first**, then Amazon.in, Flipkart, Reliance Digital, Croma. At most 8 pages. Blogs and other shops are refused.

Accept / reject each page exactly as product-copy step 3:
- Our code / barcode on the page → same product: accept.
- A different barcode → another version: reject.
- Any real disagreement with a printed fact → sister model: reject. Not mentioning a fact is not a disagreement.
- Blocked page? Send it anyway — the server reads every page itself (`read-page` is not needed here).

Send every page you read, accepted or not, plus what is printed:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$WRITE_URL/api/agent/prep/<id>/part2" -d '{ "pages": [ { "url": "https://…", "accepted": true, "why": "maker, part code on page" } ], "labelFacts": { "Model": "M8" }, "seen": {}, "labelWebsite": "" }'
```

Answer: `{ result: "part2" | "no-good-page", read, dropped }`. The server saves the pages (text + photos) for Part 3 and Part 4. Either way **go on to Part 3 now** (read the product again to get the saved pages).
- `no-good-page` → searching again gains nothing without better seed. Part 3 works from the label and photos only; your own knowledge may shape the wording, never a fact (the server drops any fact not on the label or a kept page). Part 4 flags it if that is not enough — staff then improve the seed, or publish by hand.
- Found nothing at all? Send `"pages": []` — it still counts as the one search.
- `422 Already searched` → never retry; use the saved pages. Only when the owner asks to run Part 2 again, send `"again": true` (it replaces the saved search).

## Part 3 — Process (from the saved pages only)

Read the product again (`GET /api/agent/prep/<id>`); work only from `prep.pages` (accepted ones), `prep.labelFacts` and the photos. **No new search, no new page.**

1. **Title, description, specs — improve, do not blindly rewrite.** Keep what is right in our text, fix what is wrong, fill what is missing, make the wording better. A full rewrite only when ours is empty or mostly wrong. Follow the `writing` lines (house style, keys). Facts only from the label or an accepted saved page; `specSources` = `"label"` or the saved page **url**. Warranty only the maker's; not found → `""` + "Manufacturer warranty" in `unsure`. Compatibility: exact models from the maker's list.
   **Specs merge, they do not replace:** your rows replace ours with the same label, every other old row stays. So look at `typedSpecs` first — an old row that would end up wrong or repeated (e.g. old "Model Name" next to your "Model Number" with the same value, or the same fact under two labels) must be cleared in Part 1 (`clear.specs`). Never send "Model Name" equal to "Model Number" — keep only "Model Number" when the box gives one code.
2. **Brand** — `brandId` from `masters.brands` when it is in the list. A well-known brand not in the list → **a note** ("Brand X is printed but not in the Brand list — create it, then set it"), no stop. Little-known / no name → Unbranded id + note "Change to Premium Unbranded if this is the good-quality line".
3. **Collections — set fresh.** `collectionIds` replaces the current set, main first. Same picking rules as product-copy §5 (Shop by Need + Setup Kits, never Offers, the live `masters.collections` list wins). At least one; nothing fits → a note.
4. **Shipping** — package weight / size quoted exactly as a saved page prints it, `source` = that page url. The server fills it **only when ours is empty**, and adds the note "taken from the internet, not weighed — add wrapper and packing weight". Ours already filled → it only notes a big difference.
5. **Model No** — when ours is empty, send `"modelNo": { "value": "POR 3046", "source": "label" }` (the maker's model / part code exactly as printed, or a kept page url). The server fills it only when ours is empty and the code is really on that source, then rebuilds the office name like an inventory edit — taking the code out of the custom part first, so the name never shows it twice (a custom part that is only the code is left alone, name unchanged). Ours already set and different → it only notes it. **Local goods** (Unbranded / Premium Unbranded): never sent — their codes are one-off, staff decide.
6. **Photos**:
   - `add`: photos from the saved pages you are **sure** show this exact model and colour (maker's first, sharp, no other brand's logo or watermark) → copied into our photo storage and added to the gallery now (a copy that fails is offered to staff instead). Do not also keep our own lower-quality copy of the same image — put it in `remove`.
   - `suggest`: the ones you are not sure about → offered to staff.
   - `remove` / `suggestRemove`: same as Part 1 for anything still wrong.
   - `order`: the whole gallery as you want it (our kept photos + added ones) — a clean product front first, then sides / close-ups, then box, then feel photos. Applied now.
   - `look`: crops / fixes from `photoLookOptions` (staff press Use / Undo).
   - `have` / `must` / `nice`: photo kinds (`photoKinds` keys).
   - Primary photo with any logo, watermark or text → do not put it first; note "Pick a clean primary photo".
7. **Mistake check → `notes`** — product-copy §8's list, one problem per line (name, model no. / barcode to copy in, group, photos, price plainly off …).

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$WRITE_URL/api/agent/prep/<id>/part3" -d @part3.json
```

```json
{
  "copy": {
    "title": "…", "summary": "…", "highlights": ["…"], "description": "…",
    "compatibility": [], "howToUse": [], "warranty": "",
    "specs": { "Model Number": "M8" }, "specSources": { "Model Number": "label" },
    "unsure": ["Manufacturer warranty"], "dataFlags": []
  },
  "brandId": 12,
  "collectionIds": [34, 51],
  "shipping": { "weight": "250 g", "dimensions": "12 x 8 x 4 cm", "source": "https://www.portronics.com/…" },
  "photos": {
    "add": [ { "url": "https://www.portronics.com/cdn/…/M8_-_1.png", "kind": "front" } ],
    "suggest": [], "remove": [], "suggestRemove": [],
    "order": ["https://www.portronics.com/cdn/…/M8_-_1.png", "…/2.jpg", "…/1.jpg"],
    "look": [], "have": ["box_front"], "must": ["ports"], "nice": ["in_use"]
  },
  "notes": ["Name could read better: \"8-in1 HUB-C\" → \"8-in-1 USB-C Hub\""]
}
```

Answer: `{ result: "part3", shopStatus, kept, unsure, flags, photos: { removed, added, ordered, suggested }, notes }`. `422` → fix as the message says and resend. The product is now in **Draft** for staff.

---

## Report (always, at the end)

| Product | Reached | Result | Notes |
|---|---|---|---|
| SKU · name | Part 1 / 2 / 3 | attention: reason · no good page · draft | the 1–3 most important |

Then:
> **Attention** tab: the stopped ones — fix what the reason says, then run **product prep** again (it starts at the next part).
> **Draft** tab: the processed ones — carry out the notes (Remove / Use / add photos), then run **product-recheck**.
> **No good page**: written from the label only — check them first.
