# Product prep — Parts 2 and 3 (search, then write)

Read this only on the **Parts 1 + 2 + 3** path (the product has no description yet — see SKILL.md "Two paths"). Part 1, the photo list, notes and the run call are in SKILL.md; the photo work inside Part 3 is in `photos.md`.

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
   - **Edits first** — pick and improve the main photo, cut out no-meaning backgrounds, blank a covered MRP: see "Photo edits" in `photos.md`. Then read the product again for the new links.
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

