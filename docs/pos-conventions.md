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
