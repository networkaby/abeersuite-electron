# POS Keyboard Conventions

> Single source of truth for keyboard shortcuts on the POS register
> (`/vouchers/pos/new`, `/vouchers/pos/order`, `/vouchers/pos/estimate`).

These are the **live** conventions the code implements. If a shortcut is listed
here, it works on every POS screen. If it is not listed here, it does not exist
yet.

---

## Quick reference

| Key | Action | Notes |
|-----|--------|-------|
| `/` | Focus product search — **or** fill the rest of the bill in checkout | Works from anywhere; skips when typing in a field. With the checkout dialog open, `/` fills the remaining bill amount into the focused payment line (cash by default) |
| `F1` | Counter help — new tab | Opens the POS help & shortcuts page (`/vouchers/pos/help`) in a new tab — same as the `?` rail button; works from anywhere |
| `F2` | Focus customer / party picker | Works from **any** context, including inside inputs. If a customer is already selected, enters "change mode": search for a replacement, `Esc` to cancel and restore the original |
| `Enter` (scan box) | Add the highlighted product | Falls back to the top row. Refuses to add an **amber guess row** — the cashier must arrow to it or click it first |
| `Ctrl + Enter` | Checkout / save bill | Cart must have items + customer selected |
| `Esc` | Clear product search query + dismiss dropdown | If search is already empty, blurs the input so `F2` / `/` become available |
| `Shift + Esc` | Clear bill + customer (with confirmation) | Mid-bill reset: wipes cart, adjustments and the customer — start fresh with someone else; needs a non-empty cart, no dialog open |
| `F6` | Open a new POS tab | Any time — recall is done by switching tabs manually |
| `↑` / `↓` | Move the cart-line selection — **or** jump between payment lines in checkout | `+` / `−` act on the selected line; skipped while the product dropdown is open. Inside checkout, `↑` / `↓` move focus to the previous / next payment line's amount box (line-to-line, replacing `Tab`) |
| `+` / `−` | Bump qty of the selected line | `+` adds one, `−` removes one (line drops at zero); wins over typing in the empty search box |
| `F9` | Quick cash — full bill on option-1 (Cash) | Opens checkout with cash = amount due, no change; needs cart + customer |
| `F10` | Quick pay — full bill on option-2 (UPI) | Opens checkout with the first payment account (normally UPI) = amount due; `/` inside checkout fills the rest into any selected line; needs cart + customer |

---

## Details

### `/` — Product search

Focuses the scan/type box so the cashier can immediately scan a barcode or
start typing a product name.

**Bypassed when:**
- A modal dialog is open (checkout, create-customer, etc.)
- Focus is already inside an `<input>`, `<textarea>`, or content-editable
  element (the cashier is mid-edit)

### `F1` — Counter help (new tab)

Opens `/vouchers/pos/help` — the counter-user guide (billing steps, every
shortcut, payments) — in a **new tab**, so the register stays untouched.
`preventDefault` stops the browser's own F1 help.

Same as the **`?` rail button** (bottom of the right-edge action rail), which
calls the same page. Function key: works from any context, blocked only while a
modal dialog is open.

### `F2` — Customer picker

Standard POS convention: `F2` = customer lookup. Focuses the party search box
in the top bar.

**F2 is a function key — it overrides the current context.** It works even
when focus is inside the product search, a cart line input, or any other
field. Only blocked when a modal dialog is open.

**Change-customer mode:**
- If no customer is selected → F2 simply focuses the picker.
- If a customer is already selected → F2 **unlocks** the picker, saves the
  original party in memory, and changes the placeholder to
  "Type to replace current customer · Esc to cancel".
  - **Pick a new party** → replaces the current one, exits change mode.
  - **Press `Esc`** → restores the original party, re-locks the picker, exits
    change mode.
  - **Click Clear (X)** → same as before: wipes the selection entirely.

The mouse Clear button remains unchanged. F2 is an additive keyboard path.

### `Ctrl + Enter` — Checkout / save

Opens the checkout dialog (Sale) or saves the order / estimate directly.

**Guard conditions:**
- Cart is not empty
- A customer / party is selected
- No required sale-note is missing on any line (Sale mode only)
- No save is already in progress

### `Esc` — Clear product search

**When the search box has text:**
- Clears the query
- Dismisses the product dropdown
- Keeps focus in the search box so the cashier can immediately type the next scan

**When the search box is already empty:**
- Blurs the input
- This releases focus so `F2` and `/` shortcuts become active without clicking away

### `Enter` in the scan box — add the product

Adds the highlighted row, falling back to the first row, so a barcode scanner
(which types the code and sends `Enter`) lands the item without a keystroke.

**Every row carries a confidence, shown by colour — two levels, no captions:**

| Level | Meaning | Look |
|-------|---------|------|
| Hit | A word of the query really matched the name / SKU / barcode / brand / attributes | Normal text |
| Guess | Nothing really matched — the row is only near the query | Amber text, amber left edge |

The search itself runs in up to three passes:

1. **The real search** — every query word must match. Words the cashier ran
   together are split and retried, so `pen32`, `a4paper`, `papera4` and `camcp`
   all find their product. A word that matched only through a typo (one or two
   edits, e.g. `abc` reaching "TV Remote **ACC**") is a **guess**, not a hit.
2. **Looser scoring** — no word required, wider typo budget, so `hddseaget`
   still reaches the Seagate hard disk. Always guesses.
3. **Letter-pair closeness** — the last resort. Always guesses.

**Passes 2 and 3 run only when pass 1 found no genuine hit.** A search that
worked is never padded: `seagate` shows its two hard disks, not those two
buried under ten "Sata cable" guesses. A search that failed is topped up to
**12 rows** so the box keeps its height instead of collapsing — but only with
rows that actually score, so a query with nothing near it (`xyzq`) shows the
one or two rows that do, never arbitrary filler.

**`Enter` will not add a guess row on its own.** An unknown barcode also ends
in `Enter`, and a wrong item on the bill is worse than no item — so the cashier
has to aim at the row first with `↑` / `↓` or the mouse. Otherwise a toast says
"No exact match — pick an item from the list".

The guess rows are **provisional** — added so the box never goes empty on the
cashier. Up for review once counters have used them.

---

### Scanning on the other vouchers

Purchase, sale, returns, orders, challans, GRN and rejections all share one
screen, and its **item box in each row takes a scan** — there is no separate
scan bar. Typing or scanning is the operator's choice; the box is the same box.

- A scanned barcode or a SKU typed in full is matched **exactly** on `Enter`,
  whatever the dropdown highlight is sitting on. This is deliberate: ranking
  already puts an exact code first, but a wrong item on a purchase bill is too
  expensive to leave to ranking.
- **Scanning an item already on the voucher adds to that line's quantity**
  instead of repeating it — scan the same thing five times and you get one line
  of 5. The row you were on goes back to blank so you can carry on scanning, and
  a toast names the line that grew.
- Same tiered matching as the till, but **no guess rows**: a voucher line is a
  deliberate choice, so an empty list is honest rather than unhelpful.
- The dropdown lists **50 rows** at most, with a "type more to narrow down"
  footer — it opens on focus, and mounting the whole catalogue each time was
  costing a visible pause.

---

### `F6` — New POS tab

Opens `/vouchers/pos/new` in a new browser tab. Because the POS supports
multiple simultaneous tabs, **there is no recall shortcut** — the cashier
returns to a held bill by switching tabs manually.

---

### Cart-line selection (`↑` / `↓`)

One cart line is always "selected" (a slightly stronger background tint — no border or ring change, since
every line already shares the same border treatment). It decides which
line `+` / `−` act on.

- **Default:** the last item added is selected after every scan / add.
- **`↑` / `↓`** move the selection to the previous / next line, following the
  rendered order (products first, services after) — the same list the cashier
  sees.
- **Click** any line to select it directly.
- The selected line is scrolled into view when moved by keyboard.
- Removing the selected line (`−` to zero or the trash button) hands the
  highlight to the line that took its place.

**Bypassed when:**
- The product dropdown is open — arrows there navigate the dropdown
- Focus is inside an `<input>`, `<textarea>`, or content-editable element
  (except the empty product search box)
- A modal dialog is open

---

### `+` / `−` — selected line

Steps the quantity of the selected line by one:

- `+` → qty + 1
- `−` → qty − 1; at zero the line is removed entirely

**Which line:** the currently **selected** line — the last item added by
default, moved with `↑` / `↓` or by clicking a row. Selection is keyed by
product id (not array index), so it survives the render sort (products before
services); re-scanning an item increments its original slot in place.

**Bypassed when:**
- A modal dialog is open (checkout, create-customer, etc.)
- Focus is inside an `<input>`, `<textarea>`, or content-editable element —
  **except** the product search box when it is **empty**: right after a scan
  the box has focus and no text, so `+`/`−` step the selected line instead of
  typing (an empty box never opens the dropdown on `+`/`−`)
- Ctrl/Cmd/Alt is held (browser zoom / OS combos)

Note: main-row `+` is `Shift+=`, so Shift is intentionally **not** a skip
reason — the numpad `+`/`−` keys work identically.

### `F10` — Quick pay (option-2 / UPI)

Opens checkout with the full payable amount (`payableTotal` — the total minus any
 gift card) already tendered on **option-2** — the first payment-account row
(normally UPI these days) — and no change due; the cashier just confirms. One
key for "take the money and go" on today's default payment.

**Guard conditions:**
- Cart is not empty
- A customer / party is selected
- All lines have a unit price
- No create-customer dialog is already open

A counter with no default-visible non-cash row falls back to option-1 (cash).
With the checkout already open, `F10` moves the whole bill onto option-2 — the
toggle partner of `/` below.

Like `F2`, `F10` is a function key — it works from any context, including
inside inputs, and is only blocked while a dialog is open.

### `F9` — Quick cash (option-1 / Cash)

Opens checkout with the full payable amount (`payableTotal` — the total minus
any gift card) already tendered on the **Cash** row (option-1) and no change
due; the cashier just confirms. One key for "customer pays cash".

`F9` is the cash counterpart of `F10` (quick pay on option-2 / UPI) — one key
covers each payment type. Same guard conditions as `F10` (cart not empty,
customer selected, all lines priced, no dialog open). Inside the open checkout,
`/` fills cash with the rest instead.

### `Shift + Esc` — clear the whole bill

Mid-bill, when the customer says "no" and a different customer is next, `Shift +
Esc` opens a confirmation dialog with **Clear bill** already focused — `Enter`
confirms instantly, `Esc` / **Cancel** aborts:

- Clears the cart, tenders, coupon / loyalty / gift card and adjustments.
- **Also drops the customer** — the register is completely fresh, ready to pick
  a new party (unlike the post-sale reset, which keeps the customer for a quick
  re-bill).
- Returns focus to the scan box.

Why `Shift + Esc`: `Esc` already means "clear" (query → dropdown → focus), so
Shift is the natural "clear everything" escalator. `Ctrl + Esc` is the Windows
Start-menu chord and `Alt + Esc` cycles windows, so both are out.

**Guard conditions:**
- Cart is not empty
- No dialog is open (checkout, create-customer, adjustments, shift, share…)

### `/` inside checkout — fill the rest of the bill into the selected line

While the checkout dialog is open, `/` fills the **remaining bill amount** into
the payment line that currently has focus — one key for the mouse ✓ "fill
remaining" helper on whichever line the cashier is on:

- **Focus on a payment line's amount / ref box** → that line gets the rest
  (`bill − cash − every other line`).
- **Focus on the Cash row (or anywhere else)** → the Cash row gets the rest
  (`bill − payment lines`). This is the common case right after opening
  checkout, where focus sits on the cash input — with no other amounts entered
  the "rest" is the full bill.

Other lines are left untouched — it's a fill-the-rest action, not a
"move everything here" one. Outside the checkout, `/` keeps its product-search
role (focus the scan box).

### `↑` / `↓` inside checkout — jump between payment lines

While the checkout dialog is open, `↑` / `↓` move focus to the **previous / next
payment line's amount box** — the keyboard replacement for `Tab` across the
tender list (Cash → payment line 1 → payment line 2 → …):

- **Focus on the Cash row**, `↓` → the first payment line's amount box; `↓`
  again → the next line; `↑` steps back.
- **Focus on an in-between field** (cash return, a line's ref box) → the arrow
  steps to the nearest line amount in that direction.
- **Focus on an account dropdown or any button** → arrows keep their native
  behavior (the dropdown opens; its options are navigated with arrows).
- **Focus elsewhere in the dialog** → `↓` jumps to the first line, `↑` to the
  last.

`shift` / `ctrl` / `alt` combos are left native (text selection, browser
shortcuts). Outside the checkout, `↑` / `↓` keep their cart-line role.

---

## What is deliberately absent

| Key | Reason not bound |
|-----|-----------------|
| `F3` / `F4` | Unassigned — available for future product-category shortcuts |
| `F5` | Refresh is in the shift menu; accidental browser reload is a risk |
| `F7` / `F8` | Hold / recall not needed — multiple tabs replace the suspend pattern |
| `F11` / `F12` | Unassigned |

---

## Implementation notes

- All shortcuts live in `usePosBilling.ts` inside `useEffect` keydown
  listeners. Each shortcut is one self-contained effect so they can be
  added / removed independently.
- The change-customer mode uses a `changingParty` boolean state plus a ref
  (`changingPartyRef`) so the Esc listener always sees the latest value
  without re-binding on every render.
- The original party is stored in `originalPartyRef` (a ref, not state) so
  switching back on Esc does not trigger an extra render.
- `F2` deliberately has **no** "skip when focus is in an input" guard —
  function keys must override the current context in a POS counter app.
- `/` keeps its guard because it targets a specific input; the cashier
  pressing `/` while mid-edit expects to keep typing, not lose focus.

---

## Industry norms (reference only)

> Knowledge base — commonly seen POS keyboard conventions, grouped by purpose.
> **None of this is a live convention here** unless a row says "implemented".
> Sources: vendor docs (Lightspeed, WooPOS, robotill, ACME, Shopify), Tally,
> GitHub/Gmail, and cash-register (ECR) heritage.
>
> Legend: ✅ implemented in our POS · 🚧 not implemented (candidate / parked) ·
> ⛔ deliberately not bound (reason inline)

### Product & quantity entry

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `Enter` on a cart line | Refocus the product search | Keep scanning after editing a line | ✅ |
| `Esc` | Clear search + dismiss dropdown | Ours also blurs when already empty | ✅ |
| Numpad `+` / `-` | Step qty of the highlighted / last line | Ours acts on the selected line (last added default) | ✅ |
| `*` multiplier | `*3` after a barcode sets qty 3 | Universal in scanner workflows | 🚧 |

### Transaction lifecycle

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `F6` | Hold / suspend the current bill | Park it and start fresh | ⛔ our `F6` = new POS tab; multiple tabs replace hold |
| `F7` | Recall a held bill | Pairs with F6; often a list | ⛔ not needed — switch tabs instead |
| `Ctrl + H` | Hold current bill | Chord alternative when F-keys are scarce | 🚧 |
| `Shift + Esc` | Clear bill + customer (with confirm) | Needs a confirmation dialog | ✅ ours — `Shift + Esc` with a confirm dialog |

### Payment shortcuts

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `F9` | Quick cash — open checkout with cash = total | "F2 customer, F4 product, F9 pay" | ✅ our `F9` = quick cash; `F10` = quick UPI |
| `F10` | Quick pay — tendered = total on option-2 (UPI) | One-key take-and-go on today's default payment; `/` = option-1 cash full | ✅ (Sale / Order / Estimate) |
| `1`–`4` in checkout | Pick payment method by position | `1` Cash, `2` UPI, `3` Card, `4` Cheque | 🚧 candidate (Lightspeed uses `Alt + 1…9`) |
| `C` in checkout | Toggle cash exact | "Customer pays exact" | 🚧 |

### Bill adjustments

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `F11` | Toggle tax-in / tax-out display | For mixed-price items | ⛔ POS is tax-inclusive by design |
| `D` on a cart line | Apply a discount to that line | Needs % or ₹ prompt | 🚧 tier / coupon only today |
| `Ctrl + D` | Discount the whole bill | Flat % or amount | 🚧 |
| `R` on a cart line | Return / refund qty | Negative-quantity flow | 🚧 returns are a separate dialog |

### Shift & till

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `F5` | Refresh shift / re-sync | We expose it in the shift menu | ⛔ accidental reload risk |
| `Ctrl + O` | Open shift (if closed) | Quick recovery | 🚧 |
| `Ctrl + L` | Logout / handover | Safely close and pass the counter | 🚧 |

### Navigation

| Key | Convention | Notes | Our system |
|-----|-----------|-------|-----------|
| `F1` | Help / shortcuts | Great for new cashiers | ✅ our `F1` opens `/vouchers/pos/help` in a new tab; the `?` rail button opens the same page |
| `Tab` / `Shift + Tab` | Move between top bar, search, cart, checkout | Native browser | ✅ native |
| `Ctrl + Tab` | Switch between open POS tabs | Pairs with our "New POS" | ✅ native |

### Tally context (Indian de-facto standard)

`Ctrl + Enter` / `Ctrl + A` accept and save a voucher — the same muscle memory
as our `Ctrl + Enter` checkout. `Esc` cancels / exits — matches ours.

### `?` web-app convention

GitHub and Gmail bind `?` to "show the keyboard-shortcuts help overlay".
`?` is `Shift + /` and arrives as `e.key === "?"`, so binding it cannot collide
with our `/` search shortcut.

### Realistic next-pass candidates for us

The reference's top picks are F6/F7 hold-recall (already replaced by tabs), Esc
(done) and F9 pay (covered by `Ctrl+Enter`). What actually remains open for us:

1. `Alt + 1…9` quick tender selection in checkout
2. `?` shortcut-help overlay
3. `*` qty multiplier
