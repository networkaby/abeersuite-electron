---
name: product-prep
description: Prepare AbeerSuite shop products as Claude in a loop of parts — Part 1 cleans our own data (removes wrong photos / fields, adds nothing) and checks it is enough to search, Part 2 does the ONE internet search and saves it, Part 3 writes everything from the saved pages (copy, brand, collections, shipping, photos added / removed / ordered) and moves the product to Draft. A product that already has a description goes Part 1 + Part 5 instead — photos only (pick and improve the main photo, cut out no-meaning backgrounds, blank a covered MRP, add / suggest from the saved search, order), no search, no text; photos treated by an earlier Part 5 are skipped unless the owner says "redo". A major problem stops a part and parks the product in Attention for staff; the next run starts where the last one stopped. Use when the owner says "prep products", "product prep", "run the prep loop", "prepare SKU 107102 step by step", "fix the photos of SKU …", "part 5", "redo the photos", or runs /product-prep. Not product-copy (one-shot) and not product-recheck (Part 4, verify).
---

> **Talk in SKUs.** To the owner and staff, name every product by its **SKU** (and barcode where useful) plus its name — in messages, notes and reports. The product `id` is internal to the database: use it only in API calls, never in what you say or write for people. The owner gives SKUs; look them up with `sku=`. No SKU → say so and use the name.

# Product prep (the loop)

Staff create a product fast during purchase entry — often only the custom part of
the name is right; brand, group, name and collections may be empty or wrong. Another
staff member uploads photos, sometimes onto the wrong product. This skill makes
it shop-ready in parts, and **never writes from bad data**:

| Part | Does | Major problem → | Pass → |
|---|---|---|---|
| **1 Prepare seed** | Read everything; remove what is wrong; add nothing. Then: is what is left enough to search? | Attention | stage kept, Last run line |
| **2 Search** | The **one** internet search for this product; the pages are saved | technical failure → Attention (no good page = go on from the label) | stage kept, Last run line |
| **3 Process** | Everything from the saved pages — no new search | anything for staff → Attention | Draft |
| **4 Verify** | separate skill: **product-recheck** | any problem → Attention | Ready |
| **5 Photos** | With Part 1, for a product that already has a description — photos only, no search, no text | anything for staff → Attention | Draft |

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
| **5** photos (with Part 1) | **Draft** | Attention — "fix it, then run Part 4" |

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
- **Mode 3 runs on live data.** The counter app on `:786` holds a copy of **live**, so for mode 3 the dev server on `:3000` points at the **live** database too (owner, 2026-11-17: saves Vercel CPU — the writes run on this computer). Writes then change live products. If the reads and writes clearly disagree (a product, its photos, its Last run line), the dev server is on another database — stop and say so.
- Modes 3 and 4 read from the counter app's replica, which can lag the office by a little: if a read looks older than what you just wrote, read that one product again from `$PRODUCT_COPY_WRITE_URL`.
- `401` → wrong key or the card is off for that server — stop and tell the owner.
- Why: reading from `localhost:786` keeps reads off Supabase egress and Vercel CPU; only the writes go to the server that owns them.

## Start: ask two things first

Before anything else, ask the owner **both** questions in one message, unless the request already answers them:

1. **Which mode?** — cloud · local · smart local · office (Setup above). Running in the cloud → do not ask, it is always **cloud**.
2. **Which part?**
   - **Follow Part 4** — each product runs the part its last Part 4 suggested (`prep.next`: 5 → Parts 1 + 5, 3 → Part 3, 1 → full run from Part 1). No suggestion on a product → skip it and name it in the report.
   - **Full run** (the usual) — one call per product, its path chosen by the product ("Two paths" below): no description → Parts 1 + 2 + 3; has one → Parts 1 + 5.
   - **Part 1 only** — clean the data and check it is enough to search; no search.
   - **Part 2 only** — the one search, saved (Part 1 must be done).
   - **Part 3 only** — write from the saved search (Part 2 must be done).
   - **Part 4** — verify; that is the **product-recheck** skill, say so and switch to it.
   - **Part 5 · Photos** — Parts 1 + 5 even when there is no description (owner's call). Add **"redo"** to treat photos an earlier Part 5 already did (made before the edit tool existed).

Keep both answers for the whole run. Each product carries its run records (`prep.runs`, below) — read them first; they say what ran last and whether running again would do anything. A part that cannot run yet for a product (its earlier part not done) → skip that product and name it in the report, never run the earlier part on your own.

## 0. Pick products and find where each one stands

**Staff choose the work**: they shortlist products with **Start AI** (Products list, row or bulk, or the product page) — including Attention products they have fixed. Those sit in the **Waiting** stage. So with no products named, take the Waiting list first:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/products?stage=waiting&need=all&limit=20"
```

Waiting is empty → say so and ask the owner (do not fall back to Unpublished on your own). Products named by the owner (`sku=`, `q=`) are taken whatever their stage. Same filters as product-copy's list (`sku=`, `q=`, `stage=`, `limit=`…). Tell the owner the list first, then one at a time. A Waiting product leaves Waiting by itself: Part 1 stopping → Attention, Part 3 → Draft.

Read each product:

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/prep/<id>"
```

Answer = product-copy's read (`name, brand, modelNo, barcodes, typedSpecs, photos, writing, masters …`) **plus**
`title` (online name), `group`, `shipping`, `attention` (Attention reason now), `draftNotes`, `processNotes`, and
`prep: { runs, changedSinceRun, problems, partDone, path, photosDoneAt, photoStatus, next, identityChanged, searchAllowed, searchedAt, pages, dropped, labelFacts, seen, labelWebsite }`.

**Run records first — never run the same thing twice for nothing** (owner, 2026-11-20). `prep.runs` = the last 5 runs (`{ skill, part, at, from, to }`, oldest first); the server writes one after every call — you never send it. `prep.changedSinceRun: false` and the last run is the same path you are about to run (`"1+5"`, `"1+2+3"`, `"1+3"`) → **skip the product** ("already ran on <date>, nothing changed since"), unless the owner said **"redo"** or named this SKU. `changedSinceRun: true` (staff saved it after the run) → go on.

**Set-aside problems** (owner, 2026-11-20): `prep.problems` = what staff must solve (`level`: `stop` red, `fix` yellow). One with `asideAt` was ticked **"can't fix now"** by staff — never write it again in `staff`, never stop on it; the server drops it anyway. It stays on the product for later; the products list's **Set aside** tab finds them.

**`prep.path` decides first** (owner, 2026-11-20): `"part1+part5"` (a description is there — written by staff before this loop, or by an earlier Part 3) → **Parts 1 + 5**, whatever `partDone` says. `"part1+part2+part3"` (no description) → the steps below.

Start at **part `partDone + 1`**:
- `partDone: 0`, or `identityChanged: true` (staff changed brand / model / barcode — the saved search no longer counts) → **Part 1**.
- `1` → Part 2 (`searchAllowed` true) — or Part 3 if `searchAllowed` is false and a page was kept.
- `2` → Part 3.
- `3` or `4` → done here; tell the owner to run **product-recheck** — **unless the product is in Waiting**.
- **In Waiting (`shopStatus: "WAITING"`) → always start again at Part 1**, whatever `partDone` says: staff sent it back (after fixing Attention, or to redo it). Use the saved search when there is one — send `run` with `part1` + `part3` and **no `part2`** (no new search); only a product with no saved search (`searchAllowed: true`) gets `part2`.
- In Attention: first read `attention` — check staff fixed each STOPPED line (look at the data / photos again). Not fixed → say so, leave it, next product.

Photos blocked? `GET /api/agent/products/<id>/photos/<n>` (n = place in `photos`, from 1).

## Two paths, one call each

Read the product once, look at `prep.path`, then read **only that path's file** (it keeps the cost down):

| `prep.path` | Product | Read | Send |
|---|---|---|---|
| `part1+part2+part3` | no description — never written | `search-and-write.md` (+ the photo rules in `photos.md` for Part 3's photo step) | `run` with `part1` + `part2` + `part3` |
| `part1+part5` | has a description (hand-made or an earlier Part 3) | `photos.md` | `run` with `part1` + `part5` — no search, no text |

Part 1 (below) is the same on both paths and always comes first. The server runs the parts in order and stops at Part 1 when it finds a major problem — the rest of the call is thrown away, so **decide Part 1 first** and do no search and no photo edit for a product it will stop.

### Parts 1 + 2 + 3

Do the thinking of Parts 1, 2 and 3 in order, then send it **all in one call** — one read at the start, one write at the end, like product-copy:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/run" -d '{ "part1": {…}, "part2": {…}, "part3": {…} }'
```

Each key holds exactly what that part's own call would take (shown in each Part below). The server runs them in order:
- Part 1 finds a **major** problem or `enough: false` → it stops there: `{ result: "attention", stoppedAt: 1 }` — the clean-up and notes are kept, nothing else is written. So **decide Part 1 before you search**: if you already know it will stop, send only Part 1 (`/part1`) and do not spend the search.
- Otherwise it saves the search and writes Part 3 → `{ result: "part3", … }`, product in Draft.
- Part 3 refused (`422`) → the search is still saved; fix and send `/part3` alone.

For Part 3 in one run you work from the pages **you** read (product-copy step 3, `read-page` when blocked) — the server reads the same pages once and checks every fact; `specSources` are those page urls.

### Parts 1 + 5

See `photos.md` — the same `run` call with `part1` + `part5`.

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

**Our own stamp is never a problem except on the main photo** (owner, 2026-11-19). Our stamp = the **"NETWORK service" logo**, **our shop address** (Kalaparisad Market, Abhayapuri) and **our barcode / price label** stuck on a box. On every photo **except photo 1**: never a note, never a `staff` line, never a reason to remove or suggest removing, never called a "watermark" or poor quality. On photo 1 it only makes `mainClean: false`. Someone else's logo or watermark is always a problem. When no clean main photo can be had (every box in stock already carries our label), staff tick **"Can't do"** on the main-photo row — the server then stops blocking on it.


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

## Writing notes (every part)

The server tags each line with its part ("Part 3 · …") and **a part that runs again replaces its own earlier lines** — so write the full set each run, never "as before".
- **One point per line, about 20 words.** Say **what, where, what to do**: "Photo 3 shows the 2-port model — remove it", not "Some photos may be wrong".
- **`staff`** = a human must act. **`notes`** = information staff gain from (where a fact came from, what you changed). Nothing else.
- **No "OK" / "no problem" / "looks good" lines**, no repeating what the server writes itself (photo list lines, Model No filled, weight source, Last run).
- Our own stamp on a non-main photo is never a note (see "The photo list").

## Part 1 — Prepare the seed (remove only, add nothing)

1. **Read everything**: name (the custom part is usually the most reliable), brand, group, collections, SKU, barcodes, model no., specs, title, description, shipping, warranty — and **open every photo**. Never use your own memory of the product.
2. **Find what is wrong**:
   - **Self-contradiction**: fields disagree with each other or with what is *printed* on the item / box (brand, model, capacity, wattage, size, count). Unbranded / Premium Unbranded with a small printed name is **not** a conflict.
   - **Wrong photos**: another product, old box version, someone else's watermark (our own stamp is not one).
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
6. **Photo list** → `photos` (see "The photo list" above): packing, shape, your must / optional list for this product, a tag for each photo left after the clean-up, and whether photo 1 is clean. A must photo missing (not ticked "Can't add") or an unclean main photo stops Part 1 before a search — that is on purpose. With Part 5 in the same call it does not stop: Part 5 fixes the photos and the server checks after.

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
- `part1` → go on to Part 2 (or Part 5, on that path) now.

## Report (always, at the end)

| Product | Reached | Result | Notes |
|---|---|---|---|
| SKU · name | Part 1 / 2 / 3 / 5 | attention: reason · no good page · draft | the 1–3 most important; for Part 5 what each new photo got |

Then:
> **Attention** tab: the stopped ones — fix what the reason says, then run **product prep** again (it starts at the next part).
> **Draft** tab: the processed ones — carry out the notes (Remove / Use / add photos), then run **product-recheck**.
> **No good page**: written from the label only — check them first.
