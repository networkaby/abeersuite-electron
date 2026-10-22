# v1.16.11 [urgent]

Every counter must install this today. It brings more reliable sync, the QR display retry, phone apps 2.1.1, and the new AI Setup and product photo help. **This release changes the database** — new AI tables and new settings columns. Counters must update first; until a counter has this version, its sync will pause once the office site is updated.

## Sync
- A counter no longer marks a bill, voucher or order as synced until all of its lines have arrived too. If lines are missing, the counter pulls them again until they are in.

## Counters
- If the customer QR display is not plugged in, the counter notes it once and quietly checks again every minute, instead of filling the log.

## Phone apps
- Staff and shop phone apps 2.1.1: the phone's Back button now steps back through the app's pages instead of closing the app.

## AI Setup (new, under Settings)
- Save your AI keys in one place and choose, for each AI job, which keys it tries and in what order. Every AI provider is supported, plus web search tools.
- A Test button checks a key the same way a real call would, and shows the provider's own reason when it fails.
- One Product description tab sets the default way descriptions are written: Direct AI, or Verified (reads Indian pages first and searches by barcode).

## Product photos and descriptions
- Verified descriptions can now also check photos (optional 5th step, off by default): it suggests which photos to add, which to remove, the gallery order and a better look for each photo.
- A photo checklist is saved under Product image, covering every useful side of the product.
- The Adjust image screen is wider, shows a bigger original, and can rotate, add a white border and apply quick fixes. The AI's suggested look is applied for you.
