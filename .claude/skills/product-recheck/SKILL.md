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

## 1. Pick

Usually the Draft tab: `GET /api/agent/products?stage=draft&limit=20` (or `sku=` / `q=`). Tell the owner the list, then one at a time.

## 2. Read

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$READ_URL/api/agent/prep/<id>"
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
  "$WRITE_URL/api/agent/prep/<id>/part4" -d '{ "pending": ["Photo 4 (another hub) still in the gallery — press Remove"], "notes": [] }'
```

- `pending: []` → `{ result: "verified" }`: it stays in Draft with the note "Part 4 done — verified, ready to Save as ready". **You never press Save as ready.**
- Any pending → `{ result: "attention" }`: parked in Attention with only the pending lines. Staff fix, then run product-recheck again (not product-prep — unless a pending line says so).

## Report

| Product | Result | Pending / notes |
|---|---|---|
| SKU · name | verified / attention | the main ones |

> **Verified**: open the Draft, read the last note, press **Save as ready**, publish when the time is right.
> **Attention**: fix the PENDING lines, then run **product-recheck** again.
