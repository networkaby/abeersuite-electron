---
name: product-recheck
description: Part 4 of AbeerSuite product prep — verify a shop product WITHOUT any internet search, from the saved search and the product itself, after staff acted on the notes. Checks text, specs, brand, collections, shipping, photo order and quality, the main photo, and that every earlier note was carried out; verified → moved to Ready (staff press Publish), else to Attention with only what is pending. Works even when staff prepared the product by hand. Use when the owner says "recheck products", "verify the drafts", "did staff fix them", "part 4", or runs /product-recheck.
---

> **Talk in SKUs.** To the owner and staff, name every product by its **SKU** (and barcode where useful) plus its name — in messages, notes and reports. The product `id` is internal to the database: use it only in API calls, never in what you say or write for people. The owner gives SKUs; look them up with `sku=`. No SKU → say so and use the name.

# Product recheck (Part 4 — verify)

The last part of the product-prep loop. **No internet, no search** — the search
API is limited and the product already has what it needs. Change nothing on the
product; only decide **verified** or **pending**.

Works for any product: one that went through product-prep, or one staff made by hand
(then there is no saved search — check against the label photos only, and say so).

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

## Start: ask the mode first

Before anything else, ask the owner **which mode** — cloud · local · smart local · office (Setup above) — unless the request already says. Running in the cloud → do not ask, it is always **cloud**. This skill is Part 4 only — it never changes the product's data; it only moves it: verified → **Ready** (never Published directly yet), any problem → **Attention**. When the owner says where a verified product should go, send `then` (`same` · `draft` · `ready` · `waiting`). For Parts 1–3, or **Part 5 (photos — runs with Part 1, no search, no text)** when only the photos need work, say so and switch to **product-prep**.

## 1. Pick

Usually the Draft tab: `GET /api/agent/products?stage=draft&limit=20` (or `sku=` / `q=`). Tell the owner the list, then one at a time.

## 2. Read

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/prep/<id>"
```

Use: the product fields, every photo (open each — `GET /api/agent/products/<id>/photos/<n>` if blocked), `draftNotes`, `processNotes`, `attention`, and `prep.pages` / `prep.labelFacts` (the saved search — the only outside source allowed).
`prep.identityChanged: true` → staff changed brand / model / barcode after the search: **pending** "Identity changed after the search — run product prep from Part 1".
`prep.runs` (last 5 runs, `{ skill, part, at, from, to }`) and `prep.changedSinceRun` (owner, 2026-11-20): the last run was a product-recheck and `changedSinceRun: false` → **skip** ("verified / checked on <date>, nothing changed since") unless the owner said **"redo"** or named the SKU.
`prep.problems` with `asideAt` = staff ticked **"can't fix now"**: never write it again in `pending` / `notes` — it is set aside on purpose and must not block Ready.

**Staff notes come first** (owner, 2026-11-20). `prep.staffNotes` = open instructions staff / the owner left on the product (`{ id, text, by, at }`, e.g. "add one more photo of the back", "check the warranty and fix the name"). Each one is an order for this run: do it within what this skill may do, before anything else. An open note always makes `changedSinceRun: true` — never skip a product that has one. After the run, report on **every** open note, one call each:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/note" -d '{ "noteId": "<id>", "done": true, "reply": "added the back photo as photo 3" }'
```

Could not do it (needs a person, outside this skill) → `"done": false` and say why in `reply` — it stays open for staff. Every run, refused ones included, leaves its run record by itself; you never send one.

## The photo list (send it as `photoCheck`)

The server checks the photos itself (owner, 2026-11-18 — a one-photo product with our logo on the main photo got through once). Each part (Part 4 too) sends what **you see now**:

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

> You know the product better than Part 1 did — keep, add, or drop its must photos, each drop with a reason.

## Writing notes

The server tags each line with its part ("Part 3 · …") and **a part that runs again replaces its own earlier lines** — so write the full set each run, never "as before".
- **One point per line, about 20 words.** Say **what, where, what to do**: "Photo 3 shows the 2-port model — remove it", not "Some photos may be wrong".
- **`staff`** = a human must act. **`notes`** = information staff gain from (where a fact came from, what you changed). Nothing else.
- **No "OK" / "no problem" / "looks good" lines**, no repeating what the server writes itself (photo list lines, Model No filled, weight source, Last run).
- Our own stamp on a non-main photo is never a note (see "The photo list").

## 3. Check

| Area | Pending when |
|---|---|
| **Earlier notes** | Each line in `processNotes` / `draftNotes` (Remove this photo, copy model no. X, create brand Y, fix group…) — not carried out |
| **Text** | Title / description / specs say something not on the label or an accepted saved page; a spec contradicts a photo; our support period shown as the maker's warranty |
| **Brand** | Empty or wrong while the label shows a brand that is now in `masters.brands` |
| **Collections** | None, or plainly wrong for who buys it |
| **Group** | Plainly wrong (GST) — always pending until staff fix it |
| **Shipping** | Weight or size empty |
| **Photos** | Main photo not a clean product photo without the box, or has a logo / watermark / text (our own too); another product's photo; someone else's watermark on any photo; blurry / dark; duplicates; a `must` photo kind still missing (`photoList.missing`). Our own logo / address on a **non-main** photo is fine — never flag it. Send **`photoCheck`** (below) — the server checks the must photos and the main photo itself |
| **Photo edits** | A photo cut out or blanked by Part 3 / 5 (`prep.edits`, and the Part 5 notes: "Photo n: cut out onto white (original: …)") with a ragged edge, a part of the product missing, a label or text damaged, a visible grey block → pending "Photo n edit is bad — restore the original" (Part 5 restores it, see product-prep `photos.md`). A no-meaning background still left on a photo with lots of empty space → a `note` for Part 5. Never flag a meaningful or designed background (in hand, in our shop, RGB on black), and never a blanked MRP that looks clean |

**Pending** = would be wrong or embarrassing on the shop. Smaller things (wording could be nicer, a nice-to-have photo) go in `notes`. **Any line in either sends the product to Attention** (owner, 2026-11-17) — a Published product too; going off the shop is accepted. So write a line only for a real problem; nothing found → send both empty.

## 4. Send

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part4" -d '{ "pending": ["Photo 4 (another hub) still in the gallery — press Remove"], "notes": [], "photoCheck": { "box": "carton", "shape": "4-port USB hub", "tags": [ { "url": "…/1.jpg", "kind": "front" }, { "url": "…/2.jpg", "kind": "box_back" } ], "must": ["front", "ports", "box_front", "box_back"], "nice": [], "mainClean": true } }'
```

- `pending: []` **and** `notes: []` → `{ result: "verified", shopStatus }`: the server moves it to **Ready** with "Part 4 · Verified — moved to Ready, press Publish". Staff publish; never Published directly yet (owner, 2026-11-19).
- Always send **`photoCheck`** (see "The photo list"). The server puts a missing must or an unclean main photo in pending on its own — the product is **never verified** with them (next: Part 5). A `drop` is not a problem: it goes to staff as a note.
  ```json
  "photoCheck": { "box": "carton", "shape": "palm-size gaming mouse", "tags": [ { "url": "…/1.jpg", "kind": "front" } ], "must": ["front", "left", "box_front", "box_back"], "nice": ["in_use"], "mainClean": false, "mainWhy": "held in hand, shop logo on it" }
  ```
- **You change no photo.** For each must photo still missing, look in the saved pages' photos (`prep.pages[].photos`). Found → send it in **`onPages`** (`[{ "kind": "box_back", "url": "<that page photo>" }]`): the server tells staff "found on a saved page — run Part 5". Not found → the server tells staff to take it or tick "Can't add". There is no new search: after the one search, "Can't add" means the photo stays missing.
- With any problem, also send **`next`** — the part to run after staff look: `"part5"` when only the **photos** are wrong (order, removals, an edit to make or restore, a must photo on a saved page), `"part3"` when the text, a spec row, the Model No or the weight is wrong (Part 5 writes no text), `"part1"` when the product itself is in doubt (wrong photos of another item, data badly wrong). It shows on the Last run line.
- **Products made before the skills existed** start here: Part 4 is the cheapest first look (no search, no change); its `next` tells the owner whether Part 5 or a full run is needed.
- Any line in `pending` or `notes` → `{ result: "attention" }`: parked in Attention with every line (PENDING first, then NOTE), plus a line the server adds saying where it came from ("Was Published (live on the shop) before this check — if the fix is small, publish it again") so staff can put a live product back. Staff fix, then run product-recheck again (not product-prep — unless a line says so).
- Every run leaves one **Last run** line (part, India time, result) on the product, replacing the old one — read it at the start: it shows when this product was last checked and what came of it.

## Report

| Product | Result | Pending / notes |
|---|---|---|
| SKU · name | verified / attention | the main ones |

> **Verified**: now in **Ready** — read the last note, press **Publish** when the time is right.
> **Attention**: fix the PENDING lines, then run **product-recheck** again.
