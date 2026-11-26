---
name: photo-suggest
description: Look at an AbeerSuite shop product's office name and its few existing photos, work out what the product is (type, shape, packing) and ask staff for the photos still needed for that kind of product — through product-prep's Part 1 photo list, so they show as open problems in "Shoot these" on the staff phone app and under Product image. No search, no text, no removals. Use when the owner says "photo suggest", "what photos are missing", "ask staff for more photos", "suggest photos for SKU …", or runs /photo-suggest.
---

> **Talk in SKUs.** Name products by SKU + name to people; the `id` is for API calls only.

# Photo suggest

A small, cheap run: **Part 1 of product-prep with only its photo list** — the same call, key, run modes and rules as `.claude/skills/product-prep/SKILL.md` (Setup, "The photo list"). Read those two sections; nothing else from that skill is needed. No new endpoint, no app change.

What it does **not** do: no internet search, no text, no brand / collection / group change, no `clear`, never `remove` (that is product-prep's job).

## Steps (one product at a time)

1. **Pick products** — the SKUs the owner names (`/api/agent/products?sku=…`), else ask. Read each: `GET $PRODUCT_COPY_READ_URL/api/agent/prep/<id>`.
   Skip, and say so in the report: products in **Draft / Ready / Published** unless the owner names them; a product whose `prep.runs` already shows a photo-suggest Part 1 with `changedSinceRun: false`.
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
5. **Send** the Part 1 call with only the photo list, plus one `fix` line per missing must view saying **exactly what to shoot**:

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part1" -d '{
  "enough": true,
  "fix": ["Photo needed: Box back - the side with model no., specs and MRP", "Photo needed: Bottom - underside with the sensor, on white"],
  "notes": [],
  "photos": { "box": "carton", "shape": "palm-size wired mouse",
    "tags": [ { "url": "…/1.jpg", "kind": "box_front" } ],
    "must": ["front", "top", "left", "bottom", "box_front", "box_back"], "nice": ["in_use", "size"],
    "mainClean": false, "mainWhy": "box photo, no clean product photo yet" } }'
```

   - `tags`: every existing photo with the view it shows (a < 500 px photo still gets its tag, but its view also gets a "Photo needed: … (current one is 250×164, too small)" line).
   - `fix` lines start with **"Photo needed:"** so they land in the phone app's **Shoot these** list. One view per line, about 15 words. Plain ASCII only (a hyphen, not "—": the Windows shell garbles it).
   - Nothing missing → send no `fix`; the product stays where it is.

**What staff see:** a missing must view makes Part 1 stop as usual → the product goes to **Attention** (that is how every prep skill asks staff for photos); the "Must photo missing" line and your "Photo needed" lines appear under Product image and in the phone app's Shoot these. Any later prep part / product-recheck reads and clears them the usual way; staff can tick **Not applicable** on a view that cannot be shot.

## Report

| SKU · name | Identified as | Has | Asked for |
|---|---|---|---|

Then: "Staff: shoot the photos in the phone app (Shoot these), then press **Start** so product-prep runs again."
