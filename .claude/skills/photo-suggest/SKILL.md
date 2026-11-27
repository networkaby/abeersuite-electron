---
name: photo-suggest
description: Look at an AbeerSuite shop product's office name and its few existing photos, work out what the product is (type, shape, packing) and ask staff for the photos still needed for that kind of product — as cyan tips (non-blocking open problems; tips never move the stage) that show in AI notes and the staff phone app's "Shoot these". No search, no text, no removals; on request ("photo suggest and start") it moves a product that already has every must photo to Start. Use when the owner says "photo suggest", "what photos are missing", "ask staff for more photos", "suggest photos for SKU …", or runs /photo-suggest.
---

> **Talk in SKUs.** Name products by SKU + name to people; the `id` is for API calls only.

# Photo suggest

A first **guide** for staff, before the regular product-prep stages: which photos to shoot for this kind of product. It writes **cyan tips** — open problems of the "better to do" level (owner, 2026-11-27): they show in AI notes and in the phone app's **Shoot these**, **never block, never move the stage**, and any later part / agent reads them and clears them with `/fixed` once the photo is there.

Key and run modes: product-prep `SKILL.md` Setup. No search, no text, no removals. No Part 1 call, except the Start check in step 7.

## Steps (one product at a time)

1. **Pick products** — the SKUs the owner names (`/api/agent/products?sku=…`), else ask. Read each: `GET $PRODUCT_COPY_READ_URL/api/agent/prep/<id>`.
   Skip, and say so in the report: products in **Draft / Ready / Published** unless the owner names them; a product that already has "Photo needed:" tips and no new photo since (`changedSinceRun: false`).
2. **Identify it** from the **office name** (the custom part is the most reliable) and the **existing photos** (open every one — `/api/agent/products/<id>/photos/<n>` if blocked). Decide: what it is, its **shape / size**, its **packing** (`loose`, `card`, `pouch`, `carton`). Photos and name disagree (another product) → do not suggest; report it ("run product-prep Part 1").
3. **Measure** the photos (`photo-edit.mjs size`, setup in product-prep `photos.md`): a photo under 500 px does **not** count as having that view — ask for it again.
4. **Decide the must views for this kind of product** — how the maker and good sellers (Amazon.in, Flipkart) show it, from your knowledge of the type, no search:

   | Kind | Must (besides the fixed floor) |
   |---|---|
   | Mouse | top, left side, bottom (sensor) |
   | Keyboard / combo | front (top view), in_box |
   | Cable / adapter / converter | front (whole), ports (both ends close-up) |
   | CCTV camera | front, left (side with mount), ports (cable end) |
   | DVR / router / switch | front, back (ports) |
   | Monitor | front, back (ports), left (side profile) |
   | Ink / toner / paper | front; box_back when boxed |
   | Speaker / earphone | front, ports (buttons / jack), in_box |
   | Small part (fan, RAM, paste) | front, detail (label / pins) |

   Other kinds: same thinking — only what a buyer truly needs is `must`; nice-to-haves go in `nice`. The server always adds the floor: `front` (clean product, no box) and, when boxed, `box_front` + `box_back`.
5. **Send** the tips — one line per missing view, saying **exactly what to shoot**:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$PRODUCT_COPY_WRITE_URL/api/agent/products/<id>/notes" -d '{ "tip": true, "replace": true,
  "notes": ["Photo needed: Front - the mouse out of the box, on plain white", "Photo needed: Bottom - underside with the sensor"] }'
```

   - `tip: true` = cyan, non-blocking, stage untouched. **Never send without it** — plain `/notes` parks the product in Attention.
   - `replace: true` swaps the tips an earlier photo-suggest wrote; other problems are never touched.
   - Start every line with **"Photo needed:"** (it puts the line in the phone's Shoot these). One view per line, about 15 words, plain ASCII (a hyphen, not "—": the Windows shell garbles it).
   - A photo under 500 px: "Photo needed: Box front - current one is 250x164, too small".
   - Nothing missing → send nothing.
6. Running again: judge the tips already there — a view now shot or not needed → leave it out of the new list (`replace: true` drops it). Product-prep later finds the photos there → it sends those tips in `/fixed` (or staff clear them).

7. **Start - only when the owner asks** ("photo suggest and start", "start the ones that have all photos"). For each product where step 5 sent **nothing** (every must view is there, each 500 px or more, main photo a clean product photo) and the stage is **Unpublished or Attention**: move it to Start with a Part 1 **check** call - no removals, `then: "waiting"` (the same `startAi` as the Start button):

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json"   "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part1" -d '{ "enough": true, "then": "waiting",
  "photos": { "box": "carton", "shape": "palm-size mouse", "tags": [{"url": "...", "kind": "front"}, ...],
              "must": ["front","top","left","bottom","box_front","box_back"], "nice": [], "mainClean": true } }'
```

   - Leave `removals` / `fix` / `stop` empty: this is a check, not Part 1's clean-up (the real Part 1 runs again when the next prep run takes it from Start).
   - `enough: true` only when brand + model / part code / barcode / clear box text is there to search; not sure → do not call, report "not started: not enough to search".
   - Anything missing → **never** call Part 1 (it would park the product in Attention, red). Send the tips as above and report "not started: <views> missing".
   - Reply not `waiting` (Part 1 found a must missing or the main photo not clean) → report it as it is; the product is in Attention with Part 1's line.

## Report

| SKU · name | Identified as | Has | Asked for | Start |
|---|---|---|---|---|

Start column only when asked: "Started", or "not started: <why>". Then: "Staff: shoot the photos in the phone app (Shoot these), then press **Start** so product-prep runs again."
