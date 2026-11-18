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
| **3 Process** | Everything from the saved pages — no new search | anything for staff → Attention | Draft, sign `Part 3 done` |
| **4 Verify** | separate skill: **product-recheck** | any problem → Attention | Ready |
| **5 Touch-up** | Photos and small fixes only — no search, no rewrite | anything for staff → Attention | Draft, sign `Part 5 done` |

**Major** = it would spoil the next part. **Minor** = a note; the loop goes on.
Staff fix what Attention says and run this skill again — it starts at the next part.

Rules above all:
- **No information is better than false information.**
- **One search per product.** The search API is limited (about 1000 a month). Never search again for a product that has saved pages — Part 3 and Part 4 use them. The server refuses a second search.
- Never publish (a verified product goes to Ready only through Part 4), never change the **group** (GST — note it), never create brands / collections.
- This skill and product-copy are separate. Do not mix their endpoints.

## Where each part leaves the product (owner, 2026-11-19)

**Anything only a human can do → Attention, from any stage (Published too).** Every part sends its problems in two lists: **`staff`** (a human must act — create a brand, fix the group, take a photo, check the real unit) and **`notes`** (information only — what you did, where a fact came from). Any `staff` line, or a server-found one (a must photo missing, an unclean main photo), parks the product in Attention; notes never block.

| Part | Fine → | Needs staff → |
|---|---|---|
| **1** clean seed | stays where it is (a full run goes on to Part 2) | Attention — "fix it, then press Start AI" (back to Waiting) |
| **2** search | stays where it is — nothing found is fine too, go on to Part 3 | only a **technical failure** (search tool down, error): send `"failed": "<why>"` → Attention, the one search is not used up |
| **3** process | **Draft** | Attention — "fix it, then run Part 4" |
| **4** verify (product-recheck) | **Ready** (staff press Publish — never Published directly yet) | Attention |
| **5** touch-up | **Draft** | Attention — "fix it, then run Part 4" |

**The owner's instruction wins.** When the owner says where a success should go ("keep it in Waiting", "leave it in Draft") send **`then`**: `same` · `waiting` · `draft` · `ready` · `attention`. Problems for staff still go to Attention.

Staff's loop: an Unpublished product gets its seed photos and details, staff press **Start AI** → **Waiting**; the next run picks Waiting products up from Part 1.

## Setup — run mode (where to read, where to write)

The **Claude — Product copy** key (Settings → Incoming API): `balkelaharami@420`.
Never print it in chat or write it into another file.

Every **GET** (reading a product, a list, a photo) goes to `$PRODUCT_COPY_READ_URL`; every **POST** (saving a part) goes to `$PRODUCT_COPY_WRITE_URL`. Pick the mode first:

| Mode | When | `$PRODUCT_COPY_READ_URL` | `$PRODUCT_COPY_WRITE_URL` | Key from |
|---|---|---|---|---|
| **1 · Cloud** | Running in the cloud (Cowork / claude.ai) — **always this mode there**, it cannot reach this computer | `https://office.networkservice.in` | `https://office.networkservice.in` | the key above |
| **2 · Local** | Owner says "local" — testing on the dev server | `http://localhost:3000` | `http://localhost:3000` | `.env.local`, else `.env` |
| **3 · Smart local** | Owner says "smart local" — reads from the counter app's own copy, writes to the dev server | `http://localhost:786` | `http://localhost:3000` | `.env.local`, else `.env` |
| **4 · Office** | Owner says "office" on this computer — reads from the counter app's own copy (no Supabase egress), writes to the office site | `http://localhost:786` | `https://office.networkservice.in` | `.env.local`, else `.env` |

- **Key from `.env.local`, else `.env`**: the line `PRODUCT_COPY_API_KEY=` — `.env.local` first, then `.env`; neither has it → use the key above. Read it into the variable only, never echo it.
- Before the first product, check both URLs answer (`GET $PRODUCT_COPY_READ_URL/api/agent/products?limit=1` and the same on `$PRODUCT_COPY_WRITE_URL`). One not answering → stop and say which (dev server or counter app not running).
- **Mode 3 runs on live data.** The counter app on `:786` holds a copy of **live**, so for mode 3 the dev server on `:3000` points at the **live** database too (owner, 2026-11-17: saves Vercel CPU — the writes run on this computer). Writes then change live products. If the reads and writes clearly disagree (a product, its photos, its Part done sign), the dev server is on another database — stop and say so.
- Modes 3 and 4 read from the counter app's replica, which can lag the office by a little: if a read looks older than what you just wrote, read that one product again from `$PRODUCT_COPY_WRITE_URL`.
- `401` → wrong key or the card is off for that server — stop and tell the owner.
- Why: reading from `localhost:786` keeps reads off Supabase egress and Vercel CPU; only the writes go to the server that owns them.

## Start: ask two things first

Before anything else, ask the owner **both** questions in one message, unless the request already answers them:

1. **Which mode?** — cloud · local · smart local · office (Setup above). Running in the cloud → do not ask, it is always **cloud**.
2. **Which part?**
   - **Follow Part 4** — each product runs the part its last Part 4 suggested (`prep.next`: 5 → Part 5, 3 → Part 3, 1 → full run from Part 1). No suggestion on a product → skip it and name it in the report.
   - **Full run** — Parts 1 → 3 in one call (the usual).
   - **Part 1 only** — clean the data and check it is enough to search; no search.
   - **Part 2 only** — the one search, saved (Part 1 must be done).
   - **Part 3 only** — write from the saved search (Part 2 must be done).
   - **Part 4** — verify; that is the **product-recheck** skill, say so and switch to it.
   - **Part 5 · Touch-up** — photos and small fixes only, no search, no rewrite. For a product after Part 3, or one staff made by hand, when a full Part 3 would cost too much.

Keep both answers for the whole run. Each product carries a **Last run** line (part, India time, result) from its previous run — read it first; it tells you what was done last and helps decide whether to run again. A part that cannot run yet for a product (its earlier part not done) → skip that product and name it in the report, never run the earlier part on your own.

## 0. Pick products and find where each one stands

**Staff choose the work**: they shortlist products with **Start AI** (Products list, row or bulk, or the product page) — including Attention products they have fixed. Those sit in the **Waiting** stage. So with no products named, take the Waiting list first:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/products?stage=waiting&need=all&limit=20"
```

Waiting is empty → say so and ask the owner (do not fall back to Unpublished on your own). Products named by the owner (`sku=`, `q=`, ids) are taken whatever their stage. Same filters as product-copy's list (`sku=`, `q=`, `stage=`, `limit=`…). Tell the owner the list first, then one at a time. A Waiting product leaves Waiting by itself: Part 1 stopping → Attention, Part 3 → Draft.

Read each product:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/prep/<id>"
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
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/run" -d '{ "part1": {…}, "part2": {…}, "part3": {…} }'
```

Each key holds exactly what that part's own call would take (shown in each Part below). The server runs them in order:
- Part 1 finds a **major** problem or `enough: false` → it stops there: `{ result: "attention", stoppedAt: 1 }` — the clean-up and notes are kept, nothing else is written. So **decide Part 1 before you search**: if you already know it will stop, send only Part 1 (`/part1`) and do not spend the search.
- Otherwise it saves the search and writes Part 3 → `{ result: "part3", … }`, product in Draft.
- Part 3 refused (`422`) → the search is still saved; fix and send `/part3` alone.

For Part 3 in one run you work from the pages **you** read (product-copy step 3, `read-page` when blocked) — the server reads the same pages once and checks every fact; `specSources` are those page urls.

Use the single-part endpoints (`/part1`, `/part2`, `/part3`) only to **restart part-way**: after Attention is fixed, or when the product already has a saved search (then leave `part2` out of `run`, or call `/part3`, working from `prep.pages`).

---

## The photo list (every part sends `photos` / `photoCheck`)

The server checks the photos itself (owner, 2026-11-18 — a one-photo product with our logo on the main photo got through once). Each part sends what **you see now**:

```json
{
  "box": "carton",
  "shape": "palm-size gaming mouse",
  "tags": [ { "url": "…/1.jpg", "kind": "front" }, { "url": "…/2.jpg", "kind": "box_back" } ],
  "must": ["front", "left", "top", "box_front", "box_back"],
  "nice": ["in_use", "size", "working"],
  "mainClean": false,
  "mainWhy": "held in hand, our shop logo across the top"
}
```

- **`box`** — how it is packed: `loose` (no box), `card` (blister / card pack), `pouch`, `carton`. Read it from the photos. The **fixed floor** the server adds on its own: a clean product photo without the box (`front`), and for any boxed product the **box front and box back** (the back carries the model and specs).
- **`shape`** — the product's shape / size in a few words.
- **`must` / `nice`** — **your own list for this product**, not a fixed table: think how the maker and good sellers (Amazon.in, Flipkart, the maker's site) show this kind of item. A mouse: top, side, underside with the sensor. A router: front, back ports, the stand. A cable: both ends close-up, coiled length. A monitor: front, back with ports, the stand, side profile. A small part (screw, fuse): front and a size photo is often enough. Only what a buyer really needs is `must`; the rest is `nice`.
- **`tags`** — every gallery photo with the kind it shows (`photoKinds` keys; in Part 3 / 5 a page photo you add counts by its page url).
- **`mainClean`** — photo 1 is the product itself, sharp, **without the box**, with no logo, watermark or text on it (ours too). In a hand, on a shelf, in the box → `false`, with `mainWhy`.

The server keeps the list on the product (staff see it under Product image), **never drops a must an earlier part set**, and works out what is missing:
- A **must** photo missing and **not ticked "Can't add"** by staff, or a main photo that is not clean → **Part 1 stops** (Attention: "Must photo missing: … — add it, or tick Can't add"). That gets us better seed before the search.
- A missing **optional** photo never stops anything.
- Staff tick **"Can't add"** when a photo just cannot be taken (box gone, item fitted) → it stops blocking; `photoList.findOnline` lists it, and **Part 2 looks for it online** (the maker's or a seller's photo of that view), Part 3 adds it when sure.
- Part 3 / Part 5: still missing → a note. Part 4: still missing, not ticked, or main not clean → **pending, never verified**.

**Later parts correct Part 1** (owner, 2026-11-18). Part 1 sees only our photos and data, so it only adds musts. Parts 3, 4 and 5 know the product (the search, the maker's pages) — keep, add, or **drop** its must photos, each drop with a reason:

```json
"drop": [ { "kind": "bottom", "why": "maker and Amazon show no underside for GM46 — plain base, nothing to show" } ]
```

- A dropped photo becomes **optional**: staff need not upload it. The reason goes to staff as a note.
- **Dropping is never a reason to remove the photo.** Other sellers not showing a view does not mean we cannot. If staff already added it, look at it: keep it unless it is ugly, low quality or adds nothing (then `remove` / `suggestRemove` with the usual reason).
- The fixed floor (clean product photo; box front + back when boxed) can never be dropped. Part 1's drops are ignored.
- Staff's "Can't add" tick is cleared by the server once that photo is dropped or is in the gallery — it only means something on a must photo still missing.

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
6. **Photo list** → `photos` (see "The photo list" above): packing, shape, your must / optional list for this product, a tag for each photo left after the clean-up, and whether photo 1 is clean. A must photo missing (not ticked "Can't add") or an unclean main photo stops Part 1 — that is on purpose.

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part1" -d @part1.json
```

```json
{
  "remove": [ { "url": "…/7.jpg", "why": "irrelevant", "note": "a different hub (4 ports)" } ],
  "suggestRemove": [ { "url": "…/3.jpg", "why": "quality", "note": "blurry, label unreadable" } ],
  "clear": { "brand": false, "title": true, "description": false, "collections": false, "specs": ["Capacity"], "shipping": false },
  "major": [],
  "notes": ["Model No is empty — sticker prints HS-SSD-E1000.", "Group looks wrong — should be SSD (GST!)"],
  "enough": true,
  "need": "",
  "photos": { "box": "carton", "shape": "4-port USB hub", "tags": [ { "url": "…/1.jpg", "kind": "front" }, { "url": "…/2.jpg", "kind": "box_front" }, { "url": "…/4.jpg", "kind": "box_back" } ], "must": ["front", "ports", "box_front", "box_back"], "nice": ["in_use", "size"], "mainClean": true }
}
```

`why` is one of `photoRemoveReasons`. Answer: `{ result: "part1" | "attention", removed, notes, findOnline }`. Fine → the product stays where it is (send `then` only when the owner says).
- `attention` → stop this product (staff fix, then run again).
- `part1` → go on to Part 2 now.

## Part 2 — The one search

Search **once**, with the cleaned data only: brand + exact model / part code (India first). **Maker's site first**, then Amazon.in, Flipkart, Reliance Digital, Croma. At most 8 pages. Blogs and other shops are refused.

**Missing photos too** — `photoList.findOnline` (and Part 1's `findOnline`) names the must photos we do not have, including the ones staff ticked "Can't add". Prefer pages that show those views (the maker's gallery, an Amazon.in listing with the box back), so Part 3 can add them. Look also at how those pages show the product — it is what your must / optional list in Part 3 should follow.

Accept / reject each page exactly as product-copy step 3:
- Our code / barcode on the page → same product: accept.
- A different barcode → another version: reject.
- Any real disagreement with a printed fact → sister model: reject. Not mentioning a fact is not a disagreement.
- Blocked page? Send it anyway — the server reads every page itself (`read-page` is not needed here).

Send every page you read, accepted or not, plus what is printed:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part2" -d '{ "pages": [ { "url": "https://…", "accepted": true, "why": "maker, part code on page" } ], "labelFacts": { "Model": "M8" }, "seen": {}, "labelWebsite": "" }'
```

**The search itself failed** (tool down, quota, error) — not "found nothing" → send only `{ "failed": "<what went wrong>" }`: the product goes to Attention and the one search is not used up.

Answer: `{ result: "part2" | "no-good-page" | "attention", read, dropped }`. The server saves the pages (text + photos) for Part 3 and Part 4. Either way **go on to Part 3 now** (read the product again to get the saved pages).
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
   - Fill the missing must photos (`photoList.findOnline`) from the saved pages when you are **sure** they are this exact model.
   - Primary photo with any logo, watermark or text → do not put it first; a maker's clean product photo is usually the best photo 1. **Our own shop logo / address on any other photo is fine — never flag it** (owner, 2026-11-17); someone else's watermark is always a problem.
   - **`photoCheck`** — the photo list **after** your changes (see "The photo list"): tag the page photos you add by their page url; refine must / optional from how the saved pages show the product. Still missing → the server adds a note; the product still goes to Draft.
7. **Mistake check** — product-copy §8's list, one problem per line (name, model no. / barcode to copy in, group, photos, price plainly off …). **Sort every line**: a human must act → **`staff`** (create a brand, fix the group, check the real unit, take a photo not found online); information only → **`notes`**. Any `staff` line sends the product to **Attention** instead of Draft.

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part3" -d @part3.json
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
    "look": []
  },
  "photoCheck": { "box": "carton", "shape": "8-in-1 USB-C hub", "tags": [ { "url": "https://www.portronics.com/cdn/…/M8_-_1.png", "kind": "front" }, { "url": "…/2.jpg", "kind": "box_front" }, { "url": "…/1.jpg", "kind": "box_back" } ], "must": ["front", "ports", "box_front", "box_back"], "nice": ["in_use"], "mainClean": true },
  "notes": ["Name could read better: \"8-in1 HUB-C\" → \"8-in-1 USB-C Hub\""]
}
```

Answer: `{ result: "part3" | "attention", shopStatus, staff, kept, unsure, flags, photos: { removed, added, ordered, suggested }, notes }`. `422` → fix as the message says and resend. Nothing for staff → **Draft**; anything for staff (yours, a brand not in the list, a must photo still missing, an unclean main photo) → **Attention**.

---

## Part 5 — Touch-up (photos and small fixes)

For a product that already has its copy — after Part 3, or written by staff by hand — when only small things need doing (new photos added by staff, a wrong spec row, a typo, an empty Model No or weight). **No internet search, no rewrite of the text.** Every fact must be on the label or a kept saved page (`prep.pages`). A product with no saved search: send what is printed on the box in `labelFacts` — then only the label counts and no photo can be added from a page.

1. Read the product (`GET $PRODUCT_COPY_READ_URL/api/agent/prep/<id>`) and open every photo. Read the Last run line and the notes.
2. Decide only small fixes:
   - **Photos** — `order` (clean product front first), `remove` the ones you are sure are wrong or duplicates, `suggestRemove` the unsure ones, `add` from the saved pages only when sure, `look` for crops. Our own logo / address only matters on the main photo.
   - **Spec rows** — `specs` to set one row (`label`, `value`, `source`: "label" or a saved page url); `specClear` for a wrong or repeated row.
   - **Text** — `textFixes` for a spelling mistake or one wrong word: `field` (title / description), `from` exactly as it is now, `to`. Anything bigger is Part 3's job — say so instead.
   - **Model No / weight / size** — only when empty, as in Part 3 (`modelNo`, `shipping`).
3. Send:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part5" -d @part5.json
```

```json
{
  "labelFacts": {},
  "specs": [ { "label": "Cable Length", "value": "1.5 m", "source": "https://www.portronics.com/products/mport-4d" } ],
  "specClear": ["Color"],
  "textFixes": [ { "field": "title", "from": "Konect", "to": "Konnect" } ],
  "photos": { "order": ["…/new-front.jpg", "…/2.jpg"], "remove": [ { "url": "…/7.jpg", "why": "duplicate", "note": "same as photo 2" } ] },
  "photoCheck": { "box": "card", "shape": "1.5 m USB-C cable", "tags": [ { "url": "…/new-front.jpg", "kind": "front" }, { "url": "…/2.jpg", "kind": "box_back" } ], "must": ["front", "ports", "box_front", "box_back"], "nice": ["size"], "mainClean": true },
  "notes": []
}
```

- **`fixed`** — the open problems in the Attention reason now (the `PENDING` / `STOPPED` / `NOTE` lines) that you fixed, **copied exactly as written**. Every other one stays open; the server never guesses. Photo lines (main photo, must photo missing) it checks again itself.
- **`staff`** — anything new only a human can do.

Answer: `{ result: "part5" | "attention", photos: { removed, added, ordered, suggested }, specsSet, staff, notes }`. A fix the server could not confirm comes back as a note, not an error. Nothing left for staff → **Draft** with "Part 5 done" and a Last run line — then run **product-recheck** (Part 4). Anything left → **Attention** with only what is still open.

## Report (always, at the end)

| Product | Reached | Result | Notes |
|---|---|---|---|
| SKU · name | Part 1 / 2 / 3 | attention: reason · no good page · draft | the 1–3 most important |

Then:
> **Attention** tab: the stopped ones — fix what the reason says, then run **product prep** again (it starts at the next part).
> **Draft** tab: the processed ones — carry out the notes (Remove / Use / add photos), then run **product-recheck**.
> **No good page**: written from the label only — check them first.
