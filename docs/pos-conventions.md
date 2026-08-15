# POS Keyboard Conventions

> Single source of truth for keyboard shortcuts on the POS register
> (/vouchers/pos/new, /vouchers/pos/order, /vouchers/pos/estimate).

These are the live conventions the code implements. If a shortcut is listed
here, it must work on every POS screen. If it is not listed here, it does not
exist yet.

---

## Quick reference

| Key | Action | Active when |
|-----|--------|-------------|
| / | Focus product search | No dialog open, not typing elsewhere |
| F2 | Focus customer / party picker | No dialog open, not typing elsewhere |
| Ctrl + Enter | Checkout / save bill | Cart has items, customer picked, no dialog open |
| F9 | Checkout / save bill | Same conditions as Ctrl + Enter |
| Esc | Clear product search query + dismiss dropdown | Search box focused or dropdown open |
| Esc twice (within 1.5 s) | Clear entire cart | Cart has items — shows confirmation dialog |
| Numpad + | Increment qty on highlighted cart line | Cart line focused |
| Numpad - | Decrement qty on highlighted cart line | Cart line focused |
| F6 | Open a new POS tab | Any time |

---

## Details

### / — Product search

Focuses the scan/type box so the cashier can immediately scan a barcode or
start typing a product name.

Bypassed when:
- A modal dialog is open (checkout, create-customer, etc.)
- Focus is already inside an input, textarea, or content-editable element

### F2 — Customer picker

Standard POS convention: F2 = customer lookup. Focuses the party search box
in the top bar.

Bypassed when:
- A modal dialog is open
- Focus is already inside an input / textarea / content-editable element

### Ctrl + Enter and F9 — Checkout / save

Both open the checkout dialog (Sale) or save the order / estimate directly.
They share the same guard conditions:
- Cart is not empty
- A customer / party is selected
- No required sale-note is missing on any line (Sale mode only)
- No save is already in progress

Why two shortcuts: Ctrl + Enter is the primary one-hand-on-scanner combo.
F9 is the conventional POS payment key and is easier for cashiers who prefer
F-key clusters.

### Esc — Clear product search

Dismisses the product dropdown and clears the search query. Does NOT blur
the search box — the cashier can immediately start typing the next scan.

### Esc twice — Clear cart

If Esc is pressed twice within 1.5 seconds while the cart has items, a
confirmation dialog appears:
  Clear the entire cart? This cannot be undone.
Only clears on explicit confirmation. A single Esc never clears the cart
by itself.

### Numpad + / - — Qty adjust

When a cart line is highlighted (via mouse click or arrow-key navigation in
the product dropdown):
- Numpad + increments qty by 1
- Numpad - decrements qty by 1

These are additive — they bump qty, they do not set it. They bypass the
inline qty input so the cashier does not need to tab into it.

### F6 — New POS tab

Opens /vouchers/pos/new in a new browser tab. Because the POS supports
multiple simultaneous tabs, there is NO recall shortcut — the cashier
returns to a held bill by switching tabs manually.

---

## What is deliberately absent

| Key | Reason not bound |
|-----|-----------------|
| F1 | Reserved for browser / OS help; POS help is in the ? rail button |
| F3 / F4 | Unassigned — available for future product-category shortcuts |
| F5 | Refresh is in the shift menu; accidental browser reload is a risk |
| F7 / F8 | Hold / recall not needed — multiple tabs replace the suspend pattern |
| F10 | Quick-cash exact not implemented yet; parking lot |
| F11 / F12 | Unassigned |

---

## Implementation notes

- All shortcuts live in usePosBilling.ts inside useEffect keydown listeners.
  Each shortcut is one self-contained effect so they can be added / removed
  independently.
- The Esc-twice timer uses a ref (lastEscRef) so the state does not
  re-render on every keypress.
- Numpad + / - are wired through the product dropdown onKeyDown so they
  only fire when a cart line is actually highlighted — they are not global.
- partySearchRef and productSearchRef are refs owned by the screen and passed
  into usePosBilling. The hook never creates its own refs for these.
