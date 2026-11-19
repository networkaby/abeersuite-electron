# AI product copy pipeline ("Generate with AI")

How a product description, specs and photo advice are drafted by AI, step by
step: what each step does and how it does it. It doesn't depend on any one AI
provider: every AI call goes through a **key chain**, so Gemini, GPT, Claude or
any OpenAI-compatible model can answer.

Part A is the reusable design. Part B maps it to AbeerSuite's files.

Core rule: **no information is better than false information.** The AI only
drafts. Staff review and save.

---

## Part A — the reusable design

### A1. The key chain (used by every AI call)

**What it does:** picks which AI key answers a call, keeps costs down, and moves
past a failing provider without the user noticing.

**How:**

1. **Settings, saved in the DB and cached on each server for a short TTL.**
   - **Keys:** provider, model, where the secret lives (env var or encrypted in
     the DB), whether it can read photos, whether it can search the web, free or
     paid, active, valid-till date, gap between calls, daily and monthly limit,
     rest time after a 429, rest time after other failures, timeout, retries.
   - **Chains:** for each job (`use`) and step, an ordered list of key ids.
2. **Usable here?** A key is skipped if it is off, past its date, its provider
   isn't built in, or its secret is missing on this server.
3. **Shared usage table** (one row per key, on the central DB): calls today and
   this month, last used, rest-until, last OK, last error. Every server and every
   desktop counter reads and writes the same rows, so limits hold across all of
   them.
4. **Picking order on each loop:**
   - Drop keys that are resting or over their limit.
   - **Free keys first.** Among free keys whose gap has passed, the least
     recently used goes first.
   - **Paid keys** only when the user switched **Premium** on and no free key is
     ready.
   - If nothing is ready: wait for the shortest gap (at least about 0.5 s),
     re-read, and try again. With Premium off, it waits for a free key rather
     than pay.
5. **Atomic claim:** one `INSERT … ON CONFLICT DO UPDATE … WHERE not resting AND
   gap passed AND under limit RETURNING`. It counts the call and reserves the
   key in one statement, so two servers can't take the same slot. A failed claim
   moves on to the next key.
6. **Call and result:**
   - Success: clear rest-until and set last OK.
   - Key failure (HTTP 400/401/402/403/429/500/503 or a timeout): retry up to the
     key's own retry count (never on a 429), then set rest-until (the limit rest
     for a 429, the fail rest otherwise) and try the next key.
   - Any other error is about the request, not the key, so it is thrown straight
     away.
7. **If the usage table is down:** the call goes ahead uncounted, with a warning
   logged once a minute. AI never stops because of bookkeeping.
8. **Errors in plain words for staff:** "credit used up", "limit reached",
   "provider refused the key", "busy", "took too long", "regular keys used up —
   turn on Premium".

**Web search inside a call:** if the provider has its own search tool (Gemini
Google Search, OpenAI web search, Claude web search), it is passed as a tool.
Otherwise separate **Web search keys** run the query first, and the result pages
are added to the prompt.

### A2. Reading AI replies

- Prompts end with "Return ONLY JSON: {…shape…}".
- The reply is parsed leniently: JSON is pulled out of any surrounding text, and
  the schema accepts drift (a number where text was expected, a list instead of a
  string, extra items) and fills defaults.
- If parsing fails, the same call is made **once more**. A second failure gives a
  clear "AI reply unreadable" error. Provider errors aren't retried here, because
  the chain already handled them.

### A3. Two flows

| | Direct AI | Verified |
|---|---|---|
| AI calls | 1 (Draft) | 2 to 3 (Check, Write, optional Photos) |
| Uses web pages | No | Yes: maker first, then big sellers |
| Fact check | Prompt rule only | Code checks every fact against its source |
| Speed and cost | Fast and cheap | Slower, more accurate |

**Direct:** one call with the product name, brand, category and photos, a strict
"write nothing you are not sure of" rule, and the output shape below.

### A4. Verified flow — the steps

Input: name (unsaved edits win), brand, category, model no, the maker's barcodes
(EAN/UPC only, not our own shop barcodes), specs staff typed earlier (may be
wrong), the shop's support period, and the gallery photos minus any marked
"skip for AI".

A step with no keys of its own **borrows the Direct flow's keys**.

#### Step 1 — Check (AI, with photos)

- **Does:** compares our typed data with what the photo shows, before anything
  is looked up, and collects the facts printed on the label.
- **How:** one AI call with the typed data and photos. The model is told never to
  use its own memory of the product. It returns:
  - `clashes`: real disagreements only, such as a different brand or model or a
    different printed number. Missing data, the same value spelled differently, a
    count only seen and not printed, and a shop warranty shorter than the
    printed one are **not** clashes.
  - `labelFacts`: values printed on the product or box, copied as printed.
  - `seen`: things only visible in the photo, worded "at least N".
  - `identity`: the facts that tell this product apart from its sister models
    (capacity, size, wattage, yield…).
  - `labelCodes`, `labelWebsite`, `branded`, and a `searchQuery` (brand + exact
    model code, or brand + type + main spec).
- **If there is any clash:** **stop.** Show staff the clashes ("field: typed X,
  photo shows Y") and write nothing. The product is parked in **Attention** with
  the clashes as the reason ("In-app AI"), from any stage, off the shop — the
  same result as Claude's clash stop (owner, 2026-11-11).

#### Step 2 — Pages (no AI)

- **Does:** finds and reads the maker's page and big-seller pages for this exact
  product.
- **How:**
  - Two web searches at the same time: `query site:<website on the box>` (or
    `query India official`), and `query` limited to the top seller sites.
  - Keep only the maker's sites (a host carrying the brand name, or the website
    on the box) and the known sellers. Prefer the maker's Indian site. Drop
    blogs, price sites and other shops. Read a fixed maximum number of pages.
  - Download each page with a timeout and a size cap. If a page comes back
    almost empty (a bot check, or a page built by JavaScript), retry through
    **Read page keys** (a rendering service), if set.
  - Read the visible text **and** the page's built-in data (JSON-LD, shop JSON),
    because barcodes often sit only there.
  - Compare codes ignoring spaces, dashes and case, and ignoring leading zeros
    for barcodes (UPC-12 = EAN-13 with a 0).
    - **Our code is on the page:** it is the same product, and the page is
      final.
    - **A different barcode of ours is on the page:** it is a different version,
      so drop it before the AI sees it (the reason is kept for the staff note).
  - Collect product photo URLs from each page's share preview and built-in data.
  - No brand, code or website means no search, and the copy is written from the
    label only.

#### Step 3 — Write (AI, text only)

- **Does:** writes the listing from **given facts only**.
- **How:** the prompt holds the label facts (the base truth), the seen facts, the
  identity facts, our typed data marked "a hint, not a fact", and each page
  labelled A, B, C… as maker or seller, with or without a code match. The rules:
  - A page with a code match: accept it.
  - Any other page: accept it only if nothing on it disagrees with a label or
    identity fact. One disagreement rejects the whole page, because it may be a
    sister model. A page that simply doesn't mention a fact is not a
    disagreement. "At least" counts are minimums.
  - Never use a fact from a rejected page. English text only.
  - Warranty: only the **maker's** warranty. The shop's support period is never
    written.
- **Returns:** title, summary, highlights, description, how to use,
  compatibility groups, specs, warranty, unsure list, plus `pages` (accepted or
  rejected, with the reason), `specSources` (each spec from "label" or a page
  letter) and `dataFlags` (where our typed data disagrees with a trusted
  source).

#### Step 4 — Server fact check (no AI)

- **Does:** catches anything the AI copied wrong or made up. Nothing reaches
  the description without passing here.
- **How:**
  - Text is normalised: lower case, commas and spaces removed.
  - **A fact is "on" a source when** every number in the value appears in the
    source text **as a whole number followed by its unit's first letters**
    ("5 Year" matches "5-year" or "5 years", but not a stray "5" or "1999").
    Only a real unit word counts as the unit (Hz, GB, mAh, year, W…), so in
    "30 Hz HDMI" the unit is "Hz", and in "USB 3.0 Port" the number stands alone.
    Digits alone prove nothing, because a long page always has them somewhere.
    A unit spelled differently ("5 yrs") fails and goes to unsure, which is
    the safe side. A value with no numbers needs at least 75% of its words (3+
    letters) to appear. Compatibility lists are checked model by model, and only
    the models found are kept.
  - Accepted pages are code-matched pages (always, whatever the AI said) plus
    pages the AI accepted.
  - For each spec, check it against the source the AI named:
    - "label" means the label facts, the seen facts and the product name.
    - A page letter means that page.
    - **A number from a seller page without a code match needs a second source**
      (the label or another accepted page). The maker's pages and code-matched
      pages are enough alone.
  - Specs worded "at least" are dropped (a minimum isn't a spec). A spec that
    fails goes to **unsure**, and its source is shown as the site, "Label" or
    "Product name".
  - Warranty: every number must appear on a trusted source, otherwise it is
    removed and marked unsure.
  - Highlights: any highlight with a number nobody printed is dropped.
- **Output also includes:** the sources used, flags, and a note for staff
  ("Verified: label + site X (barcode matched). Not used: site Y — reason").

#### Step 5 — Photo advice (AI, with photos, optional, runs alongside Step 3)

- **Does:** reviews the gallery: which photo kinds we have, must add, or nice to
  add; which to remove (duplicate, irrelevant, poor quality); the best order;
  crop, rotate and colour fixes; and which web photos show this exact product.
- **How:**
  - A separate call, so the tested copy prompt never changes.
  - It runs only when Photo AI is on.
  - It uses its own keys, or else the Check step's keys.
  - It sees our photos and then the web photos from Step 2. If a seller site
    blocks the model from downloading a photo, it asks again with our photos
    only.
  - Answers are mapped back **by URL, not position**, so a reorder can't point
    at the wrong photo. A photo staff framed by hand keeps its framing, and a
    suggestion equal to the current state is ignored.
  - Failure only drops the advice. The copy is unaffected.
  - Web photos are offered only from pages the copy kept.
  - Bulk runs skip this step.

#### Saved research ("Photos only")

- Steps 1 and 2's web photos are saved to cheap object storage (R2), one file per
  product.
- "Photos only" reruns Step 5 from that file without paying for Check or a
  search again.
- If the file is old, missing, or the product was renamed, Steps 1 and 2 run
  again. Saving never fails the run.

### A5. Output shape (both flows)

`title, summary, highlights[], description, howToUse, compatibility[{type,
models[]}], specs{label: value}, warranty, unsure[]`. Verified adds `sources[],
flags[], note, specSources{}` and the photo fields. A shop description is
assembled from these parts: Highlights → Description → Compatible With →
Specifications → Warranty.

### A6. Safety rules to keep in any project

1. The AI drafts and a person saves. The draft route writes nothing to the
   product.
2. Never let the model use its own memory of a product, only the photo, label
   and fetched pages.
3. Check the photo against the typed data first, and stop on a clash.
4. A barcode match is the strongest proof. A different barcode drops the page.
5. Every fact must be found on its source by **code**, not by the AI's word.
6. The shop's own warranty or support period is never published as the maker's.
7. Free keys before paid, paid keys only when the user opts in, shared counters
   across servers, and a failing key rests.
8. Optional extras (photo advice) run separately and may fail without breaking
   the main result.

### A7. Porting checklist

- [ ] Tables: `ai_key` (settings above), `ai_chain_step` (use, step, position,
      keyId), `ai_key_usage` (counters, rest, last error), plus an org setting
      for the default flow and the Photo AI switch.
- [ ] Encrypt DB-saved keys with a shared server secret.
- [ ] Chain runner + claim SQL (A1). Use an AI SDK that wraps every provider
      (the Vercel `ai` package here).
- [ ] Lenient JSON parse + one retry (A2).
- [ ] Web search keys + page reader with a JS-render fallback (Step 2).
- [ ] Fact checker (Step 4). It is about 40 lines of plain code.
- [ ] Prompts: Check, Write, Photos (copy from Part B's files and adapt the shop
      wording).
- [ ] UI: a flow picker, a Premium switch, a Photo AI switch, a draft preview
      with sources, flags and unsure items, and save through the normal edit
      API.

### A8. Running the Verified steps with Claude instead of API keys

The same steps can be done by Claude in a chat or Cowork app, with no AI key
cost on the server:

| Step | Who does it |
|---|---|
| 1 Check, 2 Pages, 3 Write, 5 Photo advice | Claude itself (it reads the photos, searches and reads the pages) |
| 4 Fact check | **The server.** It downloads Claude's pages again and checks every fact. The checker is the same code used for our own AI. |

- **What makes this safe:** Claude sends page **URLs**, not page text. The server reads each page itself, keeps only the maker's site and known sellers, drops a page that shows a different barcode, and then runs the fact check. Claude can't get a fact through that isn't really on the page.
- **Where the result goes:** straight onto the product, and the product moves to **Draft** (off the shop). Claude's text replaces ours (owner, 2026-11-10). Its notes and photo advice stay beside it on the product page. Staff review, press **Save as ready**, and Publish when the time is right; **Discard draft** puts the old stage back (Claude's text stays). The agent never publishes.
- **Three endpoints:**
  - a backlog list (paged in the DB)
  - one product's Step-1 input, plus the house-style rules, so Claude writes in the same style as our AI
  - submit the draft
- **Brand and collections:** the product endpoint also sends the brand and collection masters (cached). Claude's brand replaces ours, and it may **add** collections (existing ones stay, the main one is unchanged), using existing ids only. Both go straight onto the product (the agent key is trusted for this).
- **Notes:** anything staff should fix (a brand or collection to create, a spelling mistake, a wrong group, an empty Model No) comes back as notes, shown under "Notes for you" on the product page. Claude never creates masters and never changes the group (GST).
- **A site blocks Claude?** `POST /api/agent/read-page` reads it through the server's own path: plain download, then the "Read page" keys on AI Setup (Scrape.do…), free keys first, within their limits. Maker or known sellers only, never a private address, so it is not an open scraper. Search keys (Tavily, Exa) are not lent to Claude; its own search is enough.
- **Photos:** Claude sends `photoPicks` (photo link + kind) from the accepted pages. The server keeps a pick only if an accepted page really shows that photo, puts the maker's first, flags seller photos "check before use", and offers them on the product page. Nothing is added to the gallery by itself.
- **Shipping:** Claude quotes the package weight and size exactly as the source prints them; the server finds the text on the label or an accepted page, converts it itself (grams, whole cm rounded up) and sets it on the product.
- **Photo order and looks (same as our photo AI):** Claude may send `photos.order` (our photo urls, best first) and `photos.look` (crop / focus / fixes / rotate / background from `photoLookOptions`). The server runs them through the same `arrangeFrom` as Step 5, so staff get the same **Use / Undo** card; a photo staff framed by hand keeps its framing.
- **Photos through our server:** `GET /api/agent/products/{id}/photos/{n}` serves photo n of that product's own gallery (Skip-for-AI left out) — for when Claude's workspace blocks the photo host. Only the product's own photos, never any other URL.
- **A clash stops Claude** (our data vs the photo): no copy is saved, but the clash and the other mistakes it saw park the product in **Attention** with them as the reason (`/notes`), so staff see them in the Attention tab.
- **No page read:** a draft saved with no page at all gets a note saying the copy is from the label and photos only. Notes on the copy POST: up to 40 lines.
- **Review mode:** `POST /api/agent/products/{id}/notes` adds notes only (no field changes) and parks the product in the Attention stage, off the shop, with the notes as the reason (Attention tab, banner on the product page) until staff Save as draft or Save as ready (owner, 2026-11-11).
- **Compatibility:** the checked list is kept as the product's **"Compatible Models"** spec (no new column). Claude's compatibility-only mode (`POST /api/agent/products/{id}/compatibility`) refreshes just that list: the server keeps only models on an accepted page and replaces the old list on the product (which moves to Draft). The shop (`src/shared/lib/shop/compatibility.ts`) turns it into three product-page rows: **Made for this one** (printer → its inks and heads), **For the same machine** (black ink → the colours and the head), **Works with these** (ink → the printers we sell). A model matches only as a whole phrase in a product name ("Smart Tank 580" never matches "5800"), across brands. Search (results and the suggestion box) reads the list too.
- **Claude only leaves products in Draft** (owner, 2026-11-08): it never presses Save as ready and never publishes. Review notes park it in Attention instead.
- **One skill file** tells Claude the steps and rules, including a mistake checklist (name, codes, brand, collections, group, photos, description, shipping).

- **Product prep (a separate loop, 2026-11-16):** the `product-prep` / `product-recheck` skills run the same checks in four parts — clean our data, ONE saved search (R2 `ai-prep/<id>.json`), process from the saved pages, verify without internet — through `/api/agent/prep/{id}` (`agentProductPrep.ts`). product-copy's own route is unchanged. Photo edits (2026-11-19): Claude cuts photos out to white / blanks a covered MRP with the free ISNet model on its own side ([`photo-edit.mjs`](../.claude/skills/product-prep/photo-edit.mjs)) and sends the result to `POST /api/agent/products/{id}/photos/{n}` (`edit=cutout|blank|restore`), which swaps it into the gallery and keeps the original in Cloudinary.

### A9. Shop stages (Draft is a stage)

**Stages:** Unpublished → Draft → Ready → Published, plus Pending. One product = one copy = one stage (owner, 2026-11-10: *"only one copy no parallel"*).

| Stage | Work done? | Decided to sell? | In the shop? | Waits for |
|---|---|---|---|---|
| Unpublished | No | No | No | Someone to work on it |
| Draft | Being done (staff, AI, Claude) | No | No | Save as ready |
| Attention | Stopped — a manual check is needed | No | No | Someone to check it, then Save as draft / ready |
| Ready | Yes, checked | Not yet, on purpose | No | Your decision (stock arriving, a festival) |
| Pending | Yes | Yes | No, held back | A publish rule to be met; then live by itself |
| Published | Yes | Yes | Yes | Nothing |

- Pending isn't stored; it's worked out each time from "Published" and the publish rules.
- **Attention** (owner, 2026-11-11) is a stage: a Draft parked because the work is blocked on a manual check (name and photo clash → verify the unit in the warehouse next working day). Staff park it from Draft with **Flag attention** (row, ticked Draft rows or the product page; anyone who can save the product since 2026-11-14; `POST /api/ecommerce/products/attention`, [`shopAttention.ts`](src/modules/ecommerce/lib/shopAttention.ts)); Claude's review notes park it from any stage. Off the shop. It leaves only by **Save as draft** (back to work, the reason still shown) or **Save as ready** (reason cleared); Mark ready / Publish / bulk actions skip it. Reason, who and when: `shopAttention` / `shopAttentionBy` / `shopAttentionAt`.
- The shop reads one "live now" flag: Published and the rules met.
- Every edit goes straight onto the product. There is no second copy, so the list, Cowork and the shop all read the same data.

**Buttons on the product page:**

| | Buttons |
|---|---|
| Unsaved changes | **Save** (stage stays — a Published product changes live) · **Save as draft** (→ Draft, off the shop) · **Save as ready** |
| Draft | **Save as ready** · **Discard draft** (back to the stage it came from; the edits stay — `shopDraftJson.stageBefore`) |
| Unpublished | Mark ready |
| Ready | Publish |
| Published / Pending | Unpublish (→ **Ready**) |

- Photos save onto the product at once, whatever the stage (a Published product's photos change live).
- Bulk Mark ready / Publish / Unpublish skip products in Draft and name them.
- `InvProduct.shopDraftJson` now holds only what a Draft carries beside the fields: `stageBefore`, Claude's `aiCopy` (notes, photo advice) and review `notes`. Save as ready / Discard draft clear it.

**Products list tabs:** All · Unpublished · Draft · Ready · Published · Pending.

**Moving old draft copies:** `POST /api/ecommerce/products/old-drafts` (product-masters permission) puts every draft copy still open on its product and moves it to Draft. Run once per database after the deploy, then delete the route.

---

## Part B — where it lives in AbeerSuite

| Piece | File |
|---|---|
| API (draft only; GET returns the default flow and Photo AI) | `src/app/api/ecommerce/products/ai-copy/route.ts` |
| Key chain, usage, provider call | `src/shared/lib/ai/aiKeys.ts` |
| Web search keys | `src/shared/lib/ai/aiWeb.ts` |
| Key encryption | `src/shared/lib/security/secretBox.ts` |
| Limits, flows, steps, providers | `src/shared/lib/constants/ai.ts` |
| Direct flow, shared schema, JSON parse, description assembly | `src/modules/ecommerce/lib/aiProductCopy.ts` |
| Verified Steps 1, 3, 4, 5 and prompts | `src/modules/ecommerce/lib/aiVerifiedCopy.ts` |
| Step 2: search and read pages | `src/modules/ecommerce/lib/aiPageReader.ts` |
| Step 4 fact check | `src/modules/ecommerce/lib/aiFactCheck.ts` |
| Saved research (R2) | `src/modules/ecommerce/lib/aiResearchStore.ts` |
| Photo kinds and checklist | `src/modules/ecommerce/lib/photoChecklist.ts` |
| Settings screen | Settings → AI Setup |
| Claude route (its own "Claude — Product copy" key on Settings → Incoming API) | `src/app/api/agent/products/route.ts` (+ `[id]/route.ts`, `[id]/copy/route.ts`, `[id]/photos/[n]/route.ts`), `src/modules/ecommerce/lib/agentProductCopy.ts` |
| Claude's steps (skill) | `.claude/skills/product-copy/SKILL.md` |
| Shop stage rule | `src/modules/ecommerce/lib/shopListing.ts` (`nextShopStatus`, `resolveShopListing`) |

Chain names: Direct = `product_copy` / `draft`. Verified = `product_copy_verified`
with steps `check`, `write`, `photos` (an empty step borrows `product_copy/draft`,
and an empty `photos` step borrows `check`). Usage counters live on the cloud DB
(`prismaLive`), so desktop counters and Vercel share them.
