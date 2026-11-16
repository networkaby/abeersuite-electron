---
name: product-recheck
description: Part 4 of AbeerSuite product prep — verify a shop product WITHOUT any internet search, from the saved search and the product itself, after staff acted on the notes. Checks text, specs, brand, collections, shipping, photo order and quality, the main photo, and that every earlier note was carried out; verified → noted ready for staff to Save as ready, else back to Attention with only what is pending. Works even when staff prepared the product by hand. Use when the owner says "recheck products", "verify the drafts", "did staff fix them", "part 4", or runs /product-recheck.
---

# Product recheck (Part 4 — verify)

The last part of the product-prep loop. **No internet, no search** — the search
API is limited and the product already has what it needs. Change nothing on the
product; only decide **verified** or **pending**.

Works for any product: one that went through product-prep, or one staff made by hand
(then there is no saved search — check against the label photos only, and say so).

## Setup

`$ABEERSUITE_URL` and `$PRODUCT_COPY_API_KEY`, as product-copy / product-prep. Never print the key.

## 1. Pick

Usually the Draft tab: `GET /api/agent/products?stage=draft&limit=20` (or `sku=` / `q=`). Tell the owner the list, then one at a time.

## 2. Read

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$ABEERSUITE_URL/api/agent/prep/<id>"
```

Use: the product fields, every photo (open each — `GET /api/agent/products/<id>/photos/<n>` if blocked), `draftNotes`, `processNotes`, `attention`, and `prep.pages` / `prep.labelFacts` (the saved search — the only outside source allowed).
`prep.identityChanged: true` → staff changed brand / model / barcode after the search: **pending** "Identity changed after the search — run product prep from Part 1".

## 3. Check

| Area | Pending when |
|---|---|
| **Earlier notes** | Each line in `processNotes` / `draftNotes` (Remove this photo, copy model no. X, create brand Y, fix group…) — not carried out |
| **Text** | Title / description / specs say something not on the label or an accepted saved page; a spec contradicts a photo; our support period shown as the maker's warranty |
| **Brand** | Empty or wrong while the label shows a brand that is now in `masters.brands` |
| **Collections** | None, or plainly wrong for who buys it |
| **Group** | Plainly wrong (GST) — always pending until staff fix it |
| **Shipping** | Weight or size empty |
| **Photos** | Main photo not a clean product front, or has a logo / watermark / text; another product's photo; blurry / dark; duplicates; a `must` photo kind still missing |

**Pending** = would be wrong or embarrassing on the shop. Small things (wording could be nicer, a nice-to-have photo) are `notes`, not pending.

## 4. Send

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$ABEERSUITE_URL/api/agent/prep/<id>/part4" -d '{ "pending": ["Photo 4 (another hub) still in the gallery — press Remove"], "notes": [] }'
```

- `pending: []` → `{ result: "verified" }`: it stays in Draft with the note "Part 4 done — verified, ready to Save as ready". **You never press Save as ready.**
- Any pending → `{ result: "attention" }`: parked in Attention with only the pending lines. Staff fix, then run product-recheck again (not product-prep — unless a pending line says so).

## Report

| Product | Result | Pending / notes |
|---|---|---|
| SKU · name | verified / attention | the main ones |

> **Verified**: open the Draft, read the last note, press **Save as ready**, publish when the time is right.
> **Attention**: fix the PENDING lines, then run **product-recheck** again.
