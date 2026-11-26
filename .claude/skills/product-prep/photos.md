# Product prep — Part 5 (photos) and the photo rules

Read this on the **Parts 1 + 5** path (the product already has a description), and for the photo step of Part 3. Part 1, the photo list, notes and the run call are in SKILL.md.

## Photo size — measure every photo first (owner, 2026-11-27)

Looking is not enough: a 250 px thumbnail looks fine shown small, and `cutout` stretches it to 1500 px, which hides the blur. Before judging or editing, download every photo (`/photos/<n>`) and run `node photo-edit.mjs size p1.jpg p2.jpg …` (true pixels of the stored file). The **short side** decides:

| Short side | Verdict | Do |
|---|---|---|
| **< 500 px** | TOO SMALL | Never on the shop. Another photo shows the same view → `remove` (`why: "quality"`, note "250×164, too small"). It is the **only** photo of a view (a must view too) → `suggestRemove` + a `staff` line "Photo n is 250×164 — too small, reshoot <view>". Never the main photo, never edited (the tool refuses, exit 3) |
| **500–799 px** | WEAK | Keep; a `note` "Photo n is 640×480 — a bigger photo would be better". Main photo only if nothing better |
| **≥ 800 px** | ok | — |

Size beats looks: a TOO SMALL photo is never kept because it "looks sharp", and a big photo that is blurry is still poor.

## Photo edits — cut-out and covered MRP (Parts 3 and 5; owner, 2026-11-19)

We improve **our own photos**; we never regenerate them. Free tool: `photo-edit.mjs` next to this file (ISNet model, ~6 s a photo). Never invent or redraw text, MRP, barcode or any product detail.

**Do the edits first, then send the part** — an edit changes the photo's link, so read the product again before you write `order` / `photoCheck`.

**Main photo (photo 1):** pick the **best** photo **of 500 px or more on its short side** of the product — straight-on, sharp, whole product, readable — then improve it: cut it to white if its background is not already clean white. No good candidate → a `staff` line "Reshoot the main photo: <why>".

**Every other photo — decide by its background:**

| Background | Example | Do |
|---|---|---|
| No meaning — plain wall, grey sheet, empty table — with lots of empty space round the product | a blister pack on a grey sheet, a cable coil on a table | **cutout** |
| Meaningful, real — on a desk, in a hand, in use, in our shop | the combo in our shop with our banner | keep the background; `look` fixes only (brightness) — lots of empty space round the product → **`crop`**; tilted a few degrees → **`straighten`** |
| Designed / cinematic — keyboard flying in the sky, RGB glow on black, a maker's ad with headings | | leave it |
| Meaningful but poor — dark, blurry, messy, product cut off | | `staff`: reshoot, with the reason |
| See-through — product in a clear plastic bag or window pack | | **never cut** (the bag comes out ragged); leave it, or `staff` reshoot outside the bag |

Our own stamp (banner, address, our price sticker) stays on every photo except the main one — never cut a photo just to remove it.

**Covered MRP:** MRP **intentionally covered** on the pack (marker, scribble, half scratched off) → **blank** only that covered part, so the line reads as if nothing was printed. MRP printed and clearly visible → leave it. **Our own sticker (MRP + Offer Price) always stays.** No note or `staff` line needed after a blank.

**How:**

```bash
PE="$SCRATCH/photo-edit"   # once per session
mkdir -p "$PE" && cp .claude/skills/product-prep/photo-edit.mjs "$PE/" && (cd "$PE" && npm init -y >/dev/null && npm i @huggingface/transformers@3.7.2 sharp@0.34.3)

curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" -o "$PE/p<n>.jpg" "$PRODUCT_COPY_READ_URL/api/agent/products/<id>/photos/<n>"
(cd "$PE" && node photo-edit.mjs cutout p<n>.jpg p<n>-edit.jpg --solid)   # --solid for a box / card / pack; leave it off for a cable coil, ring, frame
(cd "$PE" && node photo-edit.mjs blank  p<n>.jpg p<n>-edit.jpg 0.44,0.47,0.06,0.02)   # x,y,w,h as fractions of the photo
(cd "$PE" && node photo-edit.mjs crop   p<n>.jpg p<n>-edit.jpg)                        # finds the product, crops to it + 6% margin, background kept
(cd "$PE" && node photo-edit.mjs crop   p<n>.jpg p<n>-edit.jpg 0.20,0.15,0.60,0.70)    # the model missed it → your own box
(cd "$PE" && node photo-edit.mjs straighten p<n>.jpg p<n>-edit.jpg -3)                 # degrees, + = clockwise, −15…15; empty corners cropped off
```

**`crop` / `straighten` (owner, 2026-11-21)** — only for a photo that keeps its background (cut-out photos are already framed and shadowed by `cutout`). `crop` when the product fills well under half the photo; it prints "nothing worth cutting" when it already fills it — keep the original then. Check the crop kept the **whole** product (cable ends, stand, accessories) — the model can miss a thin part; redo with your own box. `straighten` only for a visible tilt (edges of a box / desk not level), never on a deliberately angled maker shot. Send with `edit=crop` / `edit=straighten`. One edit per photo per run — crop **after** straighten if both are needed (straighten → send → read again → crop).

For `blank`, cover the **whole MRP amount** — from just after "Rs." / "₹" to just before "(inclusive …" — marker, digits and any stub alike, in one generous box; keep the "Rs." and the brackets. Crop round that line first to place the box. **Look at every `-edit.jpg` before sending it**: ragged edge, part of the product missing, a **hole cut through a white panel on the box** (redo with `--solid`), a label damaged, a grey block → do not send; keep the original. Then:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -F "edit=cutout" -F "file=@$PE/p<n>-edit.jpg;type=image/jpeg" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/products/<id>/photos/<n>"
```

Answer `{ photo, url, original, edit }` — the edited photo takes photo n's place; the original stays in our storage. **The server records every edit** (an edit of an edit keeps the first original) and writes "Photo 2: cut out onto white (original: <link>)" into the notes itself on every Part 5 run — never write that line yourself. `prep.edits` lists them. A bad edit found later → `-F edit=restore -F restore=<original>` (no file) puts it back and drops the record.


---

## Part 5 — Photos (with Part 1, in one call)

For a product that already has its text — made by staff before this loop existed, or written by an earlier Part 3 (owner, 2026-11-20). **Photos only: no search, no description, specs or names.** It always goes with Part 1 in one `run` call; `/part5` alone is refused until Part 1 has run.

**New photos only, unless "redo".** `prep.photoStatus` marks each photo `done` (an earlier Part 5 treated it) or `new` (added or changed since — an edit or a new upload has a new link). Treat only the `new` ones; a `done` photo just keeps its place in the order and the list. **The owner says "redo"** (photos treated before the edit tool existed, 2026-11-19) → treat every photo as new. `photosDoneAt: null` → nothing was treated yet: all are new.

1. Do Part 1's thinking (SKILL.md) first. It will stop (`major`) → send `/part1` alone, do **no** edits.
2. **Main photo** — pick the best photo of the product (it may be a `done` one) and make it photo 1; improve it when it is `new` (cut to white when its background is not clean white). No good candidate → `staff`: "Reshoot the main photo: <why>".
3. **Every `new` photo** — the background table above: cut out, leave, `look` fix, or `staff` reshoot; blank a covered MRP. Do the edits now (they change the links), then **read the product again**.
4. **Remove / suggest remove** — duplicates and the old copy of a photo you replaced; wrong photos are Part 1's `remove`.
5. **Add / suggest from the saved search** (`prep.pages[].photos`, only when the product has one): the missing must photos (`photoList.findOnline`) and any better view — `add` when sure it is this exact model and colour, `suggest` when not. No saved search → nothing is added; a must photo still missing goes to staff by the server.
6. **`order`** — the whole gallery: clean product photo first, then sides / close-ups, box, feel photos.
7. **`photoCheck`** — the list after your changes (SKILL.md "The photo list"); `drop` a must with a reason when the product does not need it.
8. **`shipping`** (optional, owner 2026-11-23) — the box back prints a weight or size (`Weight: 56 gm`, `Size (cm): 20 x 6 x 1.5`) → send `{ "weight": "56 g", "dimensions": "20 x 6 x 1.5 cm", "source": "label" }` (or a kept page url). The server fills only empty fields and notes where it came from. Nothing printed → leave it out. Never a `staff` line for shipping — the shop readiness gate handles a missing one.
9. **`notes`** — one line per `new` photo you **left** as it is, with why: "Photo 4 (new): kept — in use on a desk". Edited photos need no line (the server writes them, with the original). Say nothing about `done` photos. `fixed` — the open Attention lines you fixed, copied exactly.

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/run" -d @run.json
```

```json
{
  "part1": { "remove": [], "suggestRemove": [], "clear": { "specs": ["Colour"] }, "major": [], "notes": [], "enough": true, "photos": { "box": "card", "shape": "microSD card", "tags": [], "must": [], "nice": [], "mainClean": true } },
  "part5": {
    "photos": {
      "add": [], "suggest": [ { "url": "https://maker.example/back.jpg", "kind": "box_back" } ],
      "remove": [], "suggestRemove": [],
      "order": ["…/cutout-front.jpg", "…/1.jpg", "…/blanked-back.jpg"],
      "look": []
    },
    "photoCheck": { "box": "card", "shape": "microSD card", "tags": [ { "url": "…/cutout-front.jpg", "kind": "front" }, { "url": "…/blanked-back.jpg", "kind": "box_back" } ], "must": ["front", "box_front", "box_back"], "nice": [], "mainClean": true },
    "notes": ["Photo 1 (new): kept — maker photo already on white"],
    "staff": [], "fixed": []
  }
}
```

Part 1 in this call: `enough` and its photo list never stop it — Part 5 fixes the photos and the server checks the list after. Only `major` stops it (`{ result: "attention", stoppedAt: 1 }`).

Answer: `{ result: "part5" | "attention", photos: { removed, added, ordered, suggested }, staff, notes, part1 }`. Nothing for staff → **Draft** — then run **product-recheck** (Part 4). Anything left (a reshoot, a must photo still missing, a carried Attention line) → **Attention** with only what is open. The server remembers this gallery as treated: the next Part 5 sees only photos added after.

Text wrong (description, specs, name)? Not this part — say so; it is Part 3 (rewrite from the saved search) or staff.
