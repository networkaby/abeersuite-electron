# v1.17.10

An update for every counter, plus the online shop's product screens in the office.

## Counters

- A counter now gets its live-update connection from the office each time it starts, instead of carrying it inside the installer. When the office moves to another database, the counter follows at its next start.
- Counter screens no longer keep their own live connection open (chat still does); new bills and vouchers from other devices keep arriving through the counter's sync.
- A counter build that would start without live updates is now refused, so a counter can never quietly fall back to the slow 15-minute catch-up.
- If a counter's own database fails to start, it now finds its way back to the office database instead of showing errors.

## Bills

- Every printed bill (A4 and thermal) now shows the customer's address.
- The customer's GSTIN / UIN is no longer printed on bills for now.

## Editing a shop product

- The SKU box at the top now opens any product: type its name, SKU or barcode and pick it. It still shows the SKU of the product open now.
- **Prev** and **Next** buttons move to the neighbouring product in the same stage you opened it from, so a run of Drafts or Attention products can be worked through one after another.
- **Close** goes straight back to the Products list, however many products you stepped through.
- A Draft product always shows **Save as draft**, so half-done work can be saved and stays in Draft.
- The barcode in the header falls back to the SKU when the product has no barcode saved.
- An open product now follows changes made elsewhere within a second or two: the photo checklist, the stage, the Attention reason and the AI notes refresh by themselves. What you are typing is never touched.

## Product photos

- The photo checklist under Product image shows how the product is packed (no box, card pack, pouch or box) and its shape.
- Every product needs a clean photo of the item itself, without the box, as the first photo. A boxed product also needs the box front and the box back.
- Each missing must-have photo has a **Can't add** tick, for when the photo cannot be taken (box gone, item fitted). A ticked photo no longer holds the product back.

## AI product preparation

- The AI now checks the photos itself at every part: a missing must-have photo or a main photo that is not clean stops the first part (so better photos come in before the search), and the check part never passes a product with either.
- The AI decides the must-have photos for each product from how the maker and good sellers show it, and a later part can correct an earlier one — taking a photo off the must list always comes with a reason, and the photo itself is kept.
- When a must-have photo is missing, the check says who can fix it: "found on a saved page — run the touch-up" or "take it, or tick Can't add".
- A product sent back to Attention no longer shows an old "verified" note next to the new problems.
- Each part now labels its own notes, and running a part again replaces its old notes instead of adding duplicates; the same point shows only once.
- A product that needs staff now always goes to Attention; a checked product moves to Ready for staff to publish.
- Our own logo, address or price label is no longer flagged on photos other than the main one.
