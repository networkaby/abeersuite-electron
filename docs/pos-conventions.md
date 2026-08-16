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
| `/` | Focus product search | Works from anywhere; skips when typing in a field |
| `F2` | Focus customer / party picker | Works from **any** context, including inside inputs. If a customer is already selected, enters "change mode": search for a replacement, `Esc` to cancel and restore the original |
| `Ctrl + Enter` | Checkout / save bill | Cart must have items + customer selected |
| `Esc` | Clear product search query + dismiss dropdown | If search is already empty, blurs the input so `F2` / `/` become available |
| `F6` | Open a new POS tab | Any time — recall is done by switching tabs manually |
| `+` / `−` | Bump qty of the last item added | `+` adds one, `−` removes one (line drops at zero); wins over typing in the empty search box |

---

## Details

### `/` — Product search

Focuses the scan/type box so the cashier can immediately scan a barcode or
start typing a product name.

**Bypassed when:**
- A modal dialog is open (checkout, create-customer, etc.)
- Focus is already inside an `<input>`, `<textarea>`, or content-editable
  element (the cashier is mid-edit)

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

### `F6` — New POS tab

Opens `/vouchers/pos/new` in a new browser tab. Because the POS supports
multiple simultaneous tabs, **there is no recall shortcut** — the cashier
returns to a held bill by switching tabs manually.

---

### `+` / `−` — Quantity of last item added

Steps the quantity of the item the cashier most recently scanned or added:

- `+` → qty + 1
- `−` → qty − 1; at zero the line is removed entirely

**Which line:** the last *scanned* item, tracked by the hook — not the cart's
last array element. Re-scanning an item increments its original slot in place,
so array order would point at an older line.

**Bypassed when:**
- A modal dialog is open (checkout, create-customer, etc.)
- Focus is inside an `<input>`, `<textarea>`, or content-editable element —
  **except** the product search box when it is **empty**: right after a scan
  the box has focus and no text, so `+`/`−` step the last item instead of
  typing (an empty box never opens the dropdown on `+`/`−`)
- Ctrl/Cmd/Alt is held (browser zoom / OS combos)

Note: main-row `+` is `Shift+=`, so Shift is intentionally **not** a skip
reason — the numpad `+`/`−` keys work identically.

---

## What is deliberately absent

| Key | Reason not bound |
|-----|-----------------|
| `F1` | Reserved for browser / OS help; POS help is in the `?` rail button |
| `F3` / `F4` | Unassigned — available for future product-category shortcuts |
| `F5` | Refresh is in the shift menu; accidental browser reload is a risk |
| `F7` / `F8` | Hold / recall not needed — multiple tabs replace the suspend pattern |
| `F9` | Not needed — `Ctrl+Enter` already covers checkout |
| `F10` | Quick-cash exact not implemented yet; parking lot |
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

> Knowledge base — how other POS vendors bind their keys. **None of this is a
> live convention here.** It exists to justify (or challenge) our choices and
> to park ideas for future keys. Sources: official vendor docs (Lightspeed,
> WooPOS, robotill, ACME, Shopify), Tally, and GitHub/Gmail.

### Western POS vendors

| Vendor | Notable bindings |
|--------|------------------|
| **Lightspeed X-Series** | `Alt/Option + /` shows the shortcut list · `Esc` back / exit / complete sale · `Tab` focus next item · `F5` park (hold) sale · `F6` sales history · `F7` close register · `Alt/Option + S` product search · `Alt/Option + C` customer search · `Alt/Option + 1…9` choose payment type |
| **Lightspeed Retail (classic)** | `F2` register / POS functions · `F4` work orders · `F5` search customers · `Alt + 1` current sale · `Alt + 2` new sale · `Alt + 3` item search |
| **WooPOS** | `F4` open till (cash drawer) · `F9` change quantity of the selected item |
| **robotill** | `F2` customer selection · `F4` open menu · `F9` cash up · `F11` remove sale item · arrow keys move the grid selection |
| **ACME POS** | Function keys `F2`–`F8` remappable; `F9`–`F12` reserved |
| **Shopify POS** | Command-palette style (`Cmd+K` search), `Cmd + 1…9` jump to first nine items — no F-key culture |

### Tally (Indian de-facto standard — most relevant to this app)

| Key | Action |
|-----|--------|
| `Ctrl + Enter` / `Ctrl + A` | Accept / save the current voucher — the same muscle memory as our `Ctrl + Enter` checkout |
| `Esc` | Cancel / exit — matches our Esc-as-cancel philosophy |
| `F4` | Contra voucher |
| `F5` | Payment voucher |
| `F6` | Receipt voucher |
| `F7` | Journal voucher |
| `F8` | Sales voucher |
| `F9` | Purchase voucher |
| `F10` | Reversing journal / other voucher |
| `F11` / `F12` | Features / configuration |

### Web-app `?` convention

- GitHub and Gmail both bind `?` to "show the keyboard-shortcuts help overlay".
- Lightspeed X-Series uses `Alt/Option + /` for the same thing.
- `?` is `Shift + /`; it arrives as `e.key === "?"`, so binding it cannot
  collide with our `/` search shortcut.

### `+` / `-` heritage

- Originates in ECR (electronic cash register) hardware: the `PLUS` key
  adds/totals a line, `MINUS` voids/subtracts.
- Modern web POS software carries this forward as numpad `+`/`-` stepping the
  quantity of the selected / last line — which is what our `+`/`-` binding does.
- Square / Shopify use a different, complementary pattern: type a number before
  scanning to set the item's quantity (no key binding needed).

### How our bindings line up

- `F2` = customer lookup is the single most consistent convention across
  vendors (robotill, ours). ✓ Aligned.
- `Ctrl + Enter` = accept matches Tally — right muscle memory for Indian users. ✓
- `Esc` = cancel matches Tally and Lightspeed, but ours is scoped to search /
  change-mode rather than "exit the whole screen". Deliberate.
- `F6` = new tab diverges from Lightspeed's `F6` = sales history. Documented
  choice: our "recall" model is multiple tabs, so history lives in the tab bar.
- `F5` = park / hold (Lightspeed) is intentionally skipped — multiple tabs
  replaced the hold / recall pattern.
- `Alt + 1…9` quick tender (Lightspeed) is a candidate for our checkout splits.
