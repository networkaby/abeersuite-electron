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

## Start: ask the mode first

Before anything else, ask the owner **which mode** — cloud · local · smart local · office (Setup above) — unless the request already says. Running in the cloud → do not ask, it is always **cloud**. This skill is Part 4 only; for Parts 1–3 say so and switch to **product-prep**.

## 1. Pick

Usually the Draft tab: `GET /api/agent/products?stage=draft&limit=20` (or `sku=` / `q=`). Tell the owner the list, then one at a time.

## 2. Read

```bash
curl -sS -H "x-api-key: $PRODUCT_COPY_API_KEY" "$PRODUCT_COPY_READ_URL/api/agent/prep/<id>"
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
| **Photos** | Main photo not a clean product front, or has a logo / watermark / text (our own too); another product's photo; someone else's watermark on any photo; blurry / dark; duplicates; a `must` photo kind still missing. Our own logo / address on a **non-main** photo is fine — never flag it |

**Pending** = would be wrong or embarrassing on the shop. Smaller things (wording could be nicer, a nice-to-have photo) go in `notes`. **Any line in either sends the product to Attention** (owner, 2026-11-17) — a Published product too; going off the shop is accepted. So write a line only for a real problem; nothing found → send both empty.

## 4. Send

```bash
curl -sS -X POST -H "x-api-key: $PRODUCT_COPY_API_KEY" -H "content-type: application/json" \
  "$PRODUCT_COPY_WRITE_URL/api/agent/prep/<id>/part4" -d '{ "pending": ["Photo 4 (another hub) still in the gallery — press Remove"], "notes": [] }'
```

- `pending: []` **and** `notes: []` → `{ result: "verified" }`: it stays in Draft with "Part 4 done — verified, ready to Save as ready". **You never press Save as ready.**
- Any line in `pending` or `notes` → `{ result: "attention" }`: parked in Attention with every line (PENDING first, then NOTE), plus a line the server adds saying where it came from ("Was Published (live on the shop) before this check — if the fix is small, publish it again") so staff can put a live product back. Staff fix, then run product-recheck again (not product-prep — unless a line says so).
- Every run leaves one **Last run** line (part, India time, result) on the product, replacing the old one — read it at the start: it shows when this product was last checked and what came of it.

## Report

| Product | Result | Pending / notes |
|---|---|---|
| SKU · name | verified / attention | the main ones |

> **Verified**: open the Draft, read the last note, press **Save as ready**, publish when the time is right.
> **Attention**: fix the PENDING lines, then run **product-recheck** again.
